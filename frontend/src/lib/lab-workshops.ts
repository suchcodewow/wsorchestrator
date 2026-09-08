/** Reads and writes workshops and their contents. */

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  LAB_WORKSHOP_LIMITS,
  labGuides,
  labWorkshopGuides,
  labWorkshops,
  users,
  type LabWorkshop,
} from "@/db/schema";
import { slugify } from "@/lib/runs";
import { isUuid } from "@/lib/utils";

export type LabWorkshopSummary = Pick<
  LabWorkshop,
  "id" | "slug" | "title" | "summary" | "published" | "updatedAt"
> & { authorName: string | null; guideCount: number };

export type WorkshopGuideEntry = {
  id: string;
  slug: string;
  title: string;
  summary: string;
};

export type LabWorkshopWithGuides = LabWorkshop & {
  authorName: string | null;
  guides: WorkshopGuideEntry[];
};

export async function listLabWorkshops(
  canEdit: boolean,
): Promise<LabWorkshopSummary[]> {
  return db
    .select({
      id: labWorkshops.id,
      slug: labWorkshops.slug,
      title: labWorkshops.title,
      summary: labWorkshops.summary,
      published: labWorkshops.published,
      updatedAt: labWorkshops.updatedAt,
      authorName: sql<string | null>`coalesce(${users.name}, ${users.email})`,
      guideCount: sql<number>`(
        select count(*)::int from ${labWorkshopGuides}
        where ${labWorkshopGuides.workshopId} = ${labWorkshops.id}
      )`,
    })
    .from(labWorkshops)
    .leftJoin(users, eq(users.id, labWorkshops.authorId))
    .where(canEdit ? undefined : eq(labWorkshops.published, true))
    .orderBy(desc(labWorkshops.updatedAt));
}

async function guidesOf(workshopId: string): Promise<WorkshopGuideEntry[]> {
  return db
    .select({
      id: labGuides.id,
      slug: labGuides.slug,
      title: labGuides.title,
      summary: labGuides.summary,
    })
    .from(labWorkshopGuides)
    .innerJoin(labGuides, eq(labGuides.id, labWorkshopGuides.guideId))
    .where(eq(labWorkshopGuides.workshopId, workshopId))
    .orderBy(asc(labWorkshopGuides.position));
}

export async function getLabWorkshopById(
  id: string,
): Promise<LabWorkshop | null> {
  if (!isUuid(id)) return null;

  const workshop = await db.query.labWorkshops.findFirst({
    where: eq(labWorkshops.id, id),
  });
  return workshop ?? null;
}

export async function getLabWorkshopBySlug(
  slug: string,
  canEdit: boolean,
): Promise<LabWorkshopWithGuides | null> {
  const [workshop] = await db
    .select({
      id: labWorkshops.id,
      slug: labWorkshops.slug,
      title: labWorkshops.title,
      summary: labWorkshops.summary,
      published: labWorkshops.published,
      authorId: labWorkshops.authorId,
      createdAt: labWorkshops.createdAt,
      updatedAt: labWorkshops.updatedAt,
      authorName: sql<string | null>`coalesce(${users.name}, ${users.email})`,
    })
    .from(labWorkshops)
    .leftJoin(users, eq(users.id, labWorkshops.authorId))
    .where(
      canEdit
        ? eq(labWorkshops.slug, slug)
        : and(eq(labWorkshops.slug, slug), eq(labWorkshops.published, true)),
    )
    .limit(1);

  if (!workshop) return null;

  return { ...workshop, guides: await guidesOf(workshop.id) };
}

export async function getWorkshopGuide(
  workshopSlug: string,
  guideSlug: string,
  canEdit: boolean,
): Promise<{
  workshop: LabWorkshopWithGuides;
  index: number;
  previous: WorkshopGuideEntry | null;
  next: WorkshopGuideEntry | null;
} | null> {
  const workshop = await getLabWorkshopBySlug(workshopSlug, canEdit);
  if (!workshop) return null;

  const index = workshop.guides.findIndex((g) => g.slug === guideSlug);
  if (index === -1) return null;

  return {
    workshop,
    index,
    previous: workshop.guides[index - 1] ?? null,
    next: workshop.guides[index + 1] ?? null,
  };
}

const RESERVED_SLUGS = new Set(["new", "guides"]);

async function availableSlug(title: string, excludeId?: string): Promise<string> {
  const base = slugify(title, "workshop-guide");
  if (RESERVED_SLUGS.has(base)) return `${base}-workshop`;

  const taken = await db
    .select({ slug: labWorkshops.slug })
    .from(labWorkshops)
    .where(
      sql`(${labWorkshops.slug} = ${base} or ${labWorkshops.slug} like ${`${base}-%`})
          ${excludeId ? sql`and ${labWorkshops.id} <> ${excludeId}` : sql``}`,
    );

  const used = new Set(taken.map((r) => r.slug));
  if (!used.has(base)) return base;

  for (let n = 2; ; n++) {
    if (!used.has(`${base}-${n}`)) return `${base}-${n}`;
  }
}

export const labWorkshopSchema = z.object({
  title: z.string().trim().min(1).max(LAB_WORKSHOP_LIMITS.title),
  summary: z.string().trim().max(LAB_WORKSHOP_LIMITS.summary).default(""),
  published: z.boolean().default(false),
  guideIds: z
    .array(z.string().uuid())
    .max(LAB_WORKSHOP_LIMITS.guides)
    .default([]),
});

export type LabWorkshopInput = z.infer<typeof labWorkshopSchema>;

export type LabWorkshopError = "not_found" | "unknown_guide";

async function resolveContents(guideIds: string[]): Promise<string[] | null> {
  const ordered = [...new Set(guideIds)];
  if (ordered.length === 0) return ordered;

  const found = await db
    .select({ id: labGuides.id })
    .from(labGuides)
    .where(inArray(labGuides.id, ordered));

  return found.length === ordered.length ? ordered : null;
}

async function setContents(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  workshopId: string,
  ordered: string[],
): Promise<void> {
  await tx
    .delete(labWorkshopGuides)
    .where(eq(labWorkshopGuides.workshopId, workshopId));

  if (ordered.length === 0) return;

  await tx
    .insert(labWorkshopGuides)
    .values(ordered.map((guideId, position) => ({ workshopId, guideId, position })));
}

export async function createLabWorkshop(
  input: LabWorkshopInput,
  authorId: string,
): Promise<
  { ok: true; workshop: LabWorkshop } | { ok: false; error: LabWorkshopError }
> {
  const ordered = await resolveContents(input.guideIds);
  if (!ordered) return { ok: false, error: "unknown_guide" };

  const slug = await availableSlug(input.title);

  const workshop = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(labWorkshops)
      .values({
        slug,
        title: input.title,
        summary: input.summary,
        published: input.published,
        authorId,
      })
      .returning();

    await setContents(tx, created.id, ordered);
    return created;
  });

  return { ok: true, workshop };
}

export async function updateLabWorkshop(
  id: string,
  input: LabWorkshopInput,
): Promise<
  { ok: true; workshop: LabWorkshop } | { ok: false; error: LabWorkshopError }
> {
  const existing = await getLabWorkshopById(id);
  if (!existing) return { ok: false, error: "not_found" };

  const ordered = await resolveContents(input.guideIds);
  if (!ordered) return { ok: false, error: "unknown_guide" };

  const renameSlug =
    !existing.published && input.title.trim() !== existing.title;
  const slug = renameSlug ? await availableSlug(input.title, id) : undefined;

  const workshop = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(labWorkshops)
      .set({
        title: input.title,
        summary: input.summary,
        published: input.published,
        ...(slug ? { slug } : {}),
        updatedAt: new Date(),
      })
      .where(eq(labWorkshops.id, id))
      .returning();

    await setContents(tx, id, ordered);
    return updated;
  });

  return { ok: true, workshop };
}

export type AppendGuideError = "not_found" | "unknown_guide" | "full";

export async function appendGuideToWorkshop(
  workshopId: string,
  guideId: string,
): Promise<
  { ok: true; workshop: LabWorkshop } | { ok: false; error: AppendGuideError }
> {
  const workshop = await getLabWorkshopById(workshopId);
  if (!workshop) return { ok: false, error: "not_found" };

  if (!isUuid(guideId)) return { ok: false, error: "unknown_guide" };

  const guide = await db.query.labGuides.findFirst({
    where: eq(labGuides.id, guideId),
    columns: { id: true },
  });
  if (!guide) return { ok: false, error: "unknown_guide" };

  const [{ count, next }] = await db
    .select({
      count: sql<number>`count(*)::int`,
      next: sql<number>`coalesce(max(${labWorkshopGuides.position}) + 1, 0)`,
    })
    .from(labWorkshopGuides)
    .where(eq(labWorkshopGuides.workshopId, workshopId));

  if (count >= LAB_WORKSHOP_LIMITS.guides) return { ok: false, error: "full" };

  await db
    .insert(labWorkshopGuides)
    .values({ workshopId, guideId, position: next })
    .onConflictDoNothing();

  return { ok: true, workshop };
}

export async function deleteLabWorkshop(id: string): Promise<boolean> {
  if (!isUuid(id)) return false;

  const deleted = await db
    .delete(labWorkshops)
    .where(eq(labWorkshops.id, id))
    .returning({ id: labWorkshops.id });

  return deleted.length > 0;
}
