import { and, desc, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  LAB_GUIDE_LIMITS,
  labGuides,
  labWorkshopGuides,
  labWorkshops,
  users,
  type LabGuide,
} from "@/db/schema";
import { slugify } from "@/lib/runs";
import { isUuid } from "@/lib/utils";

/**
 * Reads and writes for the lab guides.
 *
 * The access rule is simpler than the one in `@/lib/runs` and is stated once,
 * here: a *published* guide is readable by anybody, signed in or not, and
 * everything else — drafts, and every write — needs a manager. Callers pass
 * `canEdit` (from `canManageLabGuides`) rather than a role, so there is one
 * place that decides and no route re-deriving it.
 */

/** A row of the index page. The body is left behind — it is never shown there. */
export type LabGuideSummary = Pick<
  LabGuide,
  "id" | "slug" | "title" | "summary" | "published" | "updatedAt"
> & { authorName: string | null };

/** A guide with its author, as the detail page and the editor need it. */
export type LabGuideWithAuthor = LabGuide & { authorName: string | null };

const withAuthor = {
  id: labGuides.id,
  slug: labGuides.slug,
  title: labGuides.title,
  summary: labGuides.summary,
  body: labGuides.body,
  published: labGuides.published,
  authorId: labGuides.authorId,
  createdAt: labGuides.createdAt,
  updatedAt: labGuides.updatedAt,
  authorName: sql<string | null>`coalesce(${users.name}, ${users.email})`,
};

/**
 * The guides to list. Drafts are included only for someone who could edit
 * them — for everybody else an unpublished guide does not exist.
 */
export async function listLabGuides(canEdit: boolean): Promise<LabGuideSummary[]> {
  const rows = await db
    .select({
      id: labGuides.id,
      slug: labGuides.slug,
      title: labGuides.title,
      summary: labGuides.summary,
      published: labGuides.published,
      updatedAt: labGuides.updatedAt,
      authorName: withAuthor.authorName,
    })
    .from(labGuides)
    .leftJoin(users, eq(users.id, labGuides.authorId))
    .where(canEdit ? undefined : eq(labGuides.published, true))
    .orderBy(desc(labGuides.updatedAt));

  return rows;
}

/** One guide by its URL slug, or null if the viewer may not see it. */
export async function getLabGuideBySlug(
  slug: string,
  canEdit: boolean,
): Promise<LabGuideWithAuthor | null> {
  const [row] = await db
    .select(withAuthor)
    .from(labGuides)
    .leftJoin(users, eq(users.id, labGuides.authorId))
    .where(
      canEdit
        ? eq(labGuides.slug, slug)
        : and(eq(labGuides.slug, slug), eq(labGuides.published, true)),
    )
    .limit(1);

  return row ?? null;
}

/**
 * Every guide, for the workshop editor's "add a guide" picker.
 *
 * Drafts included, and marked as such: composing a workshop out of labs that
 * are still being written is the normal way round, and the alternative is an
 * author who cannot add their own unfinished guide to the workshop it was
 * written for.
 */
export async function listGuidesForPicker(): Promise<
  Pick<LabGuide, "id" | "slug" | "title" | "summary" | "published">[]
> {
  return db
    .select({
      id: labGuides.id,
      slug: labGuides.slug,
      title: labGuides.title,
      summary: labGuides.summary,
      published: labGuides.published,
    })
    .from(labGuides)
    .orderBy(labGuides.title);
}

/**
 * The workshops a guide appears in.
 *
 * Shown in the guide editor, where the reuse is otherwise invisible: a guide
 * that opens three workshops looks exactly like one that opens none, right up
 * until it is edited or deleted.
 */
export async function workshopsUsingGuide(
  guideId: string,
): Promise<{ slug: string; title: string }[]> {
  if (!isUuid(guideId)) return [];

  return db
    .select({ slug: labWorkshops.slug, title: labWorkshops.title })
    .from(labWorkshopGuides)
    .innerJoin(labWorkshops, eq(labWorkshops.id, labWorkshopGuides.workshopId))
    .where(eq(labWorkshopGuides.guideId, guideId))
    .orderBy(labWorkshops.title);
}

/** One guide by id. Editors only — this is the editor's load. */
export async function getLabGuideById(
  id: string,
): Promise<LabGuideWithAuthor | null> {
  if (!isUuid(id)) return null;

  const [row] = await db
    .select(withAuthor)
    .from(labGuides)
    .leftJoin(users, eq(users.id, labGuides.authorId))
    .where(eq(labGuides.id, id))
    .limit(1);

  return row ?? null;
}

/** Path segments under `/labs` that are pages in their own right. */
const RESERVED_SLUGS = new Set(["new"]);

/**
 * A slug that is free, derived from the title.
 *
 * Collisions get a numeric suffix rather than an error: two managers naming
 * their labs "Getting started" is an ordinary thing to do, and neither of them
 * should have to think about URLs to get past it. `excludeId` is the guide
 * being renamed, so a guide keeping its own slug doesn't collide with itself.
 */
async function availableSlug(title: string, excludeId?: string): Promise<string> {
  const base = slugify(title, "lab-guide");
  // `/labs/new` is the editor. A guide that claimed that slug would be
  // unreachable — the static route wins — so it never gets to.
  if (RESERVED_SLUGS.has(base)) return `${base}-guide`;

  const taken = await db
    .select({ slug: labGuides.slug })
    .from(labGuides)
    .where(
      excludeId
        ? and(
            ne(labGuides.id, excludeId),
            sql`${labGuides.slug} = ${base} or ${labGuides.slug} like ${`${base}-%`}`,
          )
        : sql`${labGuides.slug} = ${base} or ${labGuides.slug} like ${`${base}-%`}`,
    );

  const used = new Set(taken.map((r) => r.slug));
  if (!used.has(base)) return base;

  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
}

/**
 * Everything a manager can set. Lives here rather than in the route so the
 * create and the update validate identically — they are the same form, and the
 * only difference between them is whether a row already exists.
 *
 * `slug` is absent on purpose: it is derived, never submitted.
 */
export const labGuideSchema = z.object({
  title: z.string().trim().min(1).max(LAB_GUIDE_LIMITS.title),
  summary: z.string().trim().max(LAB_GUIDE_LIMITS.summary).default(""),
  body: z.string().max(LAB_GUIDE_LIMITS.body).default(""),
  published: z.boolean().default(false),
});

export type LabGuideInput = z.infer<typeof labGuideSchema>;

export async function createLabGuide(
  input: LabGuideInput,
  authorId: string,
): Promise<LabGuide> {
  const [guide] = await db
    .insert(labGuides)
    .values({ ...input, slug: await availableSlug(input.title), authorId })
    .returning();

  return guide;
}

export type UpdateLabGuideError = "not_found";

/**
 * Update a guide.
 *
 * The slug follows the title only while the guide is a draft. Once it has been
 * published the URL is out in the world — in someone's browser history, on the
 * projector at the front of the room — and silently moving it to fix a typo in
 * the title would break every one of those. Editing a published guide's title
 * is allowed; its address is what stays put.
 */
export async function updateLabGuide(
  id: string,
  input: LabGuideInput,
): Promise<
  { ok: true; guide: LabGuide } | { ok: false; error: UpdateLabGuideError }
> {
  if (!isUuid(id)) return { ok: false, error: "not_found" };

  const existing = await db.query.labGuides.findFirst({
    where: eq(labGuides.id, id),
  });
  if (!existing) return { ok: false, error: "not_found" };

  const renameSlug =
    !existing.published && input.title.trim() !== existing.title;

  const [guide] = await db
    .update(labGuides)
    .set({
      ...input,
      ...(renameSlug ? { slug: await availableSlug(input.title, id) } : {}),
      updatedAt: new Date(),
    })
    .where(eq(labGuides.id, id))
    .returning();

  return { ok: true, guide };
}

export async function deleteLabGuide(id: string): Promise<boolean> {
  if (!isUuid(id)) return false;

  const deleted = await db
    .delete(labGuides)
    .where(eq(labGuides.id, id))
    .returning({ id: labGuides.id });

  return deleted.length > 0;
}
