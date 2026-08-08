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
 * The access rule is simpler than the one in `@/lib/runs`, and simpler than it
 * used to be here: a guide is readable by anybody, signed in or not, and every
 * *write* needs a manager. Guides carry no published flag — that decision
 * belongs to the workshop a room is pointed at, and lives in
 * `@/lib/lab-workshops`.
 */

/** A row of the index page. The body is left behind — it is never shown there. */
export type LabGuideSummary = Pick<
  LabGuide,
  "id" | "slug" | "title" | "summary" | "updatedAt"
> & { authorName: string | null };

/** A guide with its author, as the detail page and the editor need it. */
export type LabGuideWithAuthor = LabGuide & { authorName: string | null };

const withAuthor = {
  id: labGuides.id,
  slug: labGuides.slug,
  title: labGuides.title,
  summary: labGuides.summary,
  body: labGuides.body,
  authorId: labGuides.authorId,
  createdAt: labGuides.createdAt,
  updatedAt: labGuides.updatedAt,
  authorName: sql<string | null>`coalesce(${users.name}, ${users.email})`,
};

/** Every guide, most recently updated first. */
export async function listLabGuides(): Promise<LabGuideSummary[]> {
  const rows = await db
    .select({
      id: labGuides.id,
      slug: labGuides.slug,
      title: labGuides.title,
      summary: labGuides.summary,
      updatedAt: labGuides.updatedAt,
      authorName: withAuthor.authorName,
    })
    .from(labGuides)
    .leftJoin(users, eq(users.id, labGuides.authorId))
    .orderBy(desc(labGuides.updatedAt));

  return rows;
}

/** One guide by its URL slug, or null if there is no such guide. */
export async function getLabGuideBySlug(
  slug: string,
): Promise<LabGuideWithAuthor | null> {
  const [row] = await db
    .select(withAuthor)
    .from(labGuides)
    .leftJoin(users, eq(users.id, labGuides.authorId))
    .where(eq(labGuides.slug, slug))
    .limit(1);

  return row ?? null;
}

/** Every guide, for the workshop editor's "add a guide" picker. */
export async function listGuidesForPicker(): Promise<
  Pick<LabGuide, "id" | "slug" | "title" | "summary">[]
> {
  return db
    .select({
      id: labGuides.id,
      slug: labGuides.slug,
      title: labGuides.title,
      summary: labGuides.summary,
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
 * The slug always follows the title. A guide's own URL is not the address that
 * gets handed out — a room is pointed at `/labs/<workshop>`, and reads each lab
 * at `/labs/<workshop>/<guide>`, which is built from the workshop's slug and
 * the guide's current one. Keeping the address matching the title is worth more
 * than freezing a URL nobody was given, so the workshop's slug is the one that
 * stays put once published (see `@/lib/lab-workshops`).
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

  const renameSlug = input.title.trim() !== existing.title;

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
