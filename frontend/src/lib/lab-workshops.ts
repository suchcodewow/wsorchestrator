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

/**
 * Reads and writes for workshops — the ordered collections of lab guides.
 *
 * This is where publishing lives, and the only place it does: a *published*
 * workshop is readable by anybody, a draft one needs a manager, and every write
 * needs a manager. Callers pass `canEdit` rather than a role, so there is one
 * place that decides and no route re-deriving it.
 *
 * The decision covers the workshop, not its contents. Guides carry no flag of
 * their own — a workshop that is ready to teach is ready in full, and a
 * contents list that silently drops steps out of the middle is a worse thing to
 * hand a room than one that is honest about what it holds.
 */

/** A row of the workshop index. */
export type LabWorkshopSummary = Pick<
  LabWorkshop,
  "id" | "slug" | "title" | "summary" | "published" | "updatedAt"
> & { authorName: string | null; guideCount: number };

/** One guide as it appears in a workshop's contents. */
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

/**
 * Every workshop, with how many guides each holds.
 *
 * The count is a correlated subquery rather than a join and a group-by: the
 * outer row is already unique, and grouping it would only be a way to undo the
 * fan-out this avoids. Every viewer gets the same number — a workshop holds
 * what it holds.
 */
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

/** The guides in a workshop, in order. */
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

/**
 * One workshop by id, without its contents. Editors only.
 *
 * Used by the "write a new guide" round trip, which carries the workshop as an
 * id in a query string — the guide it is about to create may well rename the
 * workshop's slug out from under it if the workshop is still a draft.
 */
export async function getLabWorkshopById(
  id: string,
): Promise<LabWorkshop | null> {
  if (!isUuid(id)) return null;

  const workshop = await db.query.labWorkshops.findFirst({
    where: eq(labWorkshops.id, id),
  });
  return workshop ?? null;
}

/** One workshop and its contents, or null if the viewer may not see it. */
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

/**
 * A guide read inside a workshop, with what comes before and after it.
 *
 * Neighbours come from the same list the contents rail is built from, so "next"
 * is always somewhere the reader can actually go.
 */
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

/** Path segments under `/labs` that are pages in their own right. */
const RESERVED_SLUGS = new Set(["new", "guides"]);

/** A free slug derived from the title. See `availableSlug` in `@/lib/lab-guides`. */
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

/**
 * Everything a manager can set on a workshop.
 *
 * `guideIds` is the contents, in order — the whole list every time rather than
 * an add/remove/move verb per edit. The editor is a form: it holds an order the
 * author has been rearranging, and one request that says "this is the order
 * now" cannot half-apply the way a sequence of moves can.
 */
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

/**
 * The contents a save asked for, or null if any of it is not a real guide.
 *
 * Checked *before* the write rather than left to the foreign key, so a stale
 * editor tab holding a since-deleted guide gets a 400 saying so instead of a
 * 500 from the database. Duplicates are dropped rather than rejected: the
 * composite key forbids them, the editor never offers to add one twice, and
 * quietly keeping the first mention is friendlier than failing the whole save.
 */
async function resolveContents(guideIds: string[]): Promise<string[] | null> {
  const ordered = [...new Set(guideIds)];
  if (ordered.length === 0) return ordered;

  const found = await db
    .select({ id: labGuides.id })
    .from(labGuides)
    .where(inArray(labGuides.id, ordered));

  return found.length === ordered.length ? ordered : null;
}

/**
 * Write the contents of a workshop: delete what was there, insert the new
 * order. Runs inside the caller's transaction, on ids already resolved.
 *
 * Replace rather than reconcile. The set is at most a few dozen rows, and a
 * diff would be more code in exchange for a saving nobody can measure — while
 * being the sort of code that quietly leaves a stale `position` behind.
 */
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

/**
 * Update a workshop and its contents.
 *
 * The slug follows the title only while the workshop is a draft. Once it is
 * published the address is already on a projector somewhere, and silently
 * moving it to fix a typo in the title would break every link handed out.
 * Guides are the other way round — theirs always follows the title — because
 * this is the URL a room is actually given.
 */
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

/**
 * Put one guide at the end of a workshop's contents.
 *
 * The narrow counterpart to `updateLabWorkshop`, and the only write that adds
 * to a workshop without being handed its whole order. It exists for one flow:
 * an author in the workshop editor writes a new guide, and comes back to find
 * it already in the list rather than having to go and add what they just made.
 *
 * Two authors appending at the same instant can land on the same `position`.
 * That is harmless — it only leaves the order between those two arbitrary, and
 * the next full save rewrites the whole run to 0..n-1 — and the alternative is
 * locking the table for a button click.
 */
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

  // Already in the workshop is success, not a conflict: the author asked for it
  // to be in there, and it is.
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

  // The guides themselves are untouched — only their membership cascades.
  return deleted.length > 0;
}
