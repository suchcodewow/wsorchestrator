/** Page tours: the one a page plays, and writing, removing and marking them seen. */

import "server-only";

import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { TOUR_LIMITS, TOUR_PLACEMENTS, pageTourSteps, pageTourViews, pageTours, type TourPlacement } from "@/db/schema";
import { normalizePath, patternRegex, patternSpecificity } from "@/lib/tours/pattern";
import { tourTargetSchema, type TourTarget } from "@/lib/tours/target";

export type TourStep = {
  id: string;
  title: string;
  body: string;
  placement: TourPlacement;
  target: TourTarget;
};

export type Tour = {
  id: string;
  pathPattern: string;
  version: number;
  updatedAt: Date;
  steps: TourStep[];
};

/** A page's tour, and the version of it the caller last saw (0 for never). */
export type PageTourFor = { tour: Tour; seenVersion: number };

async function stepsOf(tourId: string): Promise<TourStep[]> {
  return db
    .select({
      id: pageTourSteps.id,
      title: pageTourSteps.title,
      body: pageTourSteps.body,
      placement: pageTourSteps.placement,
      target: pageTourSteps.target,
    })
    .from(pageTourSteps)
    .where(eq(pageTourSteps.tourId, tourId))
    .orderBy(pageTourSteps.position)
    .limit(TOUR_LIMITS.steps);
}

/** The tour of the page at `path`, the most specific pattern's when several match; null when none does. */
export async function tourForPath(path: string, userId: string): Promise<PageTourFor | null> {
  const [row] = await db
    .select({
      id: pageTours.id,
      pathPattern: pageTours.pathPattern,
      version: pageTours.version,
      updatedAt: pageTours.updatedAt,
      seenVersion: pageTourViews.seenVersion,
    })
    .from(pageTours)
    .leftJoin(pageTourViews, and(eq(pageTourViews.tourId, pageTours.id), eq(pageTourViews.userId, userId)))
    .where(sql`${normalizePath(path)} ~ ${pageTours.pathRegex}`)
    .orderBy(desc(pageTours.specificity), desc(sql`length(${pageTours.pathPattern})`))
    .limit(1);
  if (!row) return null;
  const { seenVersion, ...tour } = row;
  return { tour: { ...tour, steps: await stepsOf(tour.id) }, seenVersion: seenVersion ?? 0 };
}

/** The tour written against exactly `pattern`, or null. */
export async function tourByPattern(pattern: string): Promise<Tour | null> {
  const [row] = await db
    .select({ id: pageTours.id, pathPattern: pageTours.pathPattern, version: pageTours.version, updatedAt: pageTours.updatedAt })
    .from(pageTours)
    .where(eq(pageTours.pathPattern, pattern))
    .limit(1);
  return row ? { ...row, steps: await stepsOf(row.id) } : null;
}

export const saveTourSchema = z.object({
  /** The version the editor started from; a save over a newer one is refused. Omit to create, or to overwrite. */
  version: z.number().int().positive().optional(),
  steps: z
    .array(
      z.object({
        title: z.string().trim().max(TOUR_LIMITS.title),
        body: z.string().trim().max(TOUR_LIMITS.body),
        placement: z.enum(TOUR_PLACEMENTS).default("auto"),
        target: tourTargetSchema.refine((t) => t.tour || t.id || (t.role && t.name) || t.path, "no way to find it"),
      }),
    )
    .min(1)
    .max(TOUR_LIMITS.steps),
});

export type SaveTour = z.infer<typeof saveTourSchema>;

export type SaveResult = { ok: true; tour: Tour } | { ok: false; error: "conflict"; version: number };

/** Writes the tour of `pattern` in full — its steps replaced, its version one up — creating it if there is none. */
export async function saveTour(actorId: string, pattern: string, input: SaveTour): Promise<SaveResult> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ id: pageTours.id, version: pageTours.version })
      .from(pageTours)
      .where(eq(pageTours.pathPattern, pattern))
      .for("update")
      .limit(1);
    if (current && input.version !== undefined && input.version !== current.version) {
      return { ok: false, error: "conflict", version: current.version } as const;
    }

    const now = new Date();
    const [tour] = current
      ? await tx
          .update(pageTours)
          .set({ version: current.version + 1, updatedBy: actorId, updatedAt: now })
          .where(eq(pageTours.id, current.id))
          .returning()
      : await tx
          .insert(pageTours)
          .values({
            pathPattern: pattern,
            pathRegex: patternRegex(pattern),
            specificity: patternSpecificity(pattern),
            updatedBy: actorId,
          })
          .returning();

    await tx.delete(pageTourSteps).where(eq(pageTourSteps.tourId, tour!.id));
    const steps = await tx
      .insert(pageTourSteps)
      .values(input.steps.map((s, position) => ({ ...s, tourId: tour!.id, position })))
      .returning();

    return {
      ok: true,
      tour: {
        id: tour!.id,
        pathPattern: tour!.pathPattern,
        version: tour!.version,
        updatedAt: tour!.updatedAt,
        steps: steps.map(({ id, title, body, placement, target }) => ({ id, title, body, placement, target })),
      },
    } as const;
  });
}

/** Removes the tour of `pattern`, with its steps and who saw it; false when there was none. */
export async function deleteTour(pattern: string): Promise<boolean> {
  const gone = await db.delete(pageTours).where(eq(pageTours.pathPattern, pattern)).returning({ id: pageTours.id });
  return gone.length > 0;
}

export const markSeenSchema = z.object({
  tourId: z.string().uuid(),
  version: z.number().int().positive(),
});

/** Forgets every tour `userId` has seen, so each plays for them again; returns how many it forgot. */
export async function resetToursSeen(userId: string): Promise<number> {
  const gone = await db.delete(pageTourViews).where(eq(pageTourViews.userId, userId)).returning({ tourId: pageTourViews.tourId });
  return gone.length;
}

/** Records that `userId` has seen `version` of the tour; never lowers it. False when there is no such tour. */
export async function markTourSeen(userId: string, tourId: string, version: number): Promise<boolean> {
  const [tour] = await db
    .select({ version: pageTours.version })
    .from(pageTours)
    .where(eq(pageTours.id, tourId))
    .limit(1);
  if (!tour) return false;
  const seen = Math.min(version, tour.version);
  await db
    .insert(pageTourViews)
    .values({ userId, tourId, seenVersion: seen })
    .onConflictDoUpdate({
      target: [pageTourViews.userId, pageTourViews.tourId],
      set: { seenVersion: sql`greatest(${pageTourViews.seenVersion}, ${seen})`, seenAt: new Date() },
    });
  return true;
}
