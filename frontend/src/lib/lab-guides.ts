/** Reads and writes lab guides. */

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

export type LabGuideSummary = Pick<
  LabGuide,
  "id" | "slug" | "title" | "summary" | "updatedAt"
> & { authorName: string | null };

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

const RESERVED_SLUGS = new Set(["new", "edit"]);

async function availableSlug(title: string, excludeId?: string): Promise<string> {
  const base = slugify(title, "lab-guide");
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
