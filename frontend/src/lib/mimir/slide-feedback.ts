/**
 * Smiley and confused ratings on slide review slides, with any comment, and
 * Coach Canary Feedback's list of them. Each is kept by the slide's seed,
 * which rebuilds the slide it was about.
 */

import "server-only";

import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { VIDEO_FEEDBACK_LIMITS, VIDEO_FEEDBACK_RATINGS, mimirSlideFeedback, users, type VideoFeedbackRating } from "@/db/schema";
import type { SlideFeedbackSort } from "@/lib/list-specs";
import { generateSlide, isSeed } from "@/lib/mimir/slide-review/generate";
import { pageWindow, toPage, type ListQuery, type Page } from "@/lib/paging";
import { orderFor, searchAny } from "@/lib/paging-sql";

export const slideFeedbackSchema = z.object({
  seed: z.number().refine(isSeed),
  rating: z.enum(VIDEO_FEEDBACK_RATINGS),
  comment: z
    .string()
    .trim()
    .max(VIDEO_FEEDBACK_LIMITS.comment)
    .optional()
    .transform((c) => c || null),
});

export type SlideFeedbackInput = z.infer<typeof slideFeedbackSchema>;

export type SlideFeedbackRow = {
  id: string;
  seed: number;
  theme: string;
  rating: VideoFeedbackRating;
  comment: string | null;
  createdAt: string;
  user: { name: string | null; email: string | null } | null;
};

/** A rating, kept with the theme the seed makes, so the list can be read and sorted without rebuilding every slide. */
export async function recordSlideFeedback(userId: string, input: SlideFeedbackInput): Promise<SlideFeedbackRow> {
  const [row] = await db
    .insert(mimirSlideFeedback)
    .values({ userId, seed: input.seed, theme: generateSlide(input.seed).theme, rating: input.rating, comment: input.comment })
    .returning();
  const [who] = await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, userId));
  return { ...row!, createdAt: row!.createdAt.toISOString(), user: who ?? null };
}

const SORT_COLUMNS: Record<SlideFeedbackSort, ReturnType<typeof sql>> = {
  createdAt: sql`f.created_at`,
  theme: sql`f.theme`,
  user: sql`lower(coalesce(nullif(u.name, ''), u.email))`,
  rating: sql`f.rating`,
};

/** Every rating of a slide, a page at a time, searched by the comment or by who gave it. */
export async function listSlideFeedback(query: ListQuery<SlideFeedbackSort>): Promise<Page<SlideFeedbackRow>> {
  const { limit, offset } = pageWindow(query.page);
  const where = searchAny(query.q, [sql`f.comment`, sql`u.name`, sql`u.email`]) ?? sql`true`;
  const order = orderFor(SORT_COLUMNS[query.sort], query.dir, sql`f.created_at desc`, sql`f.id`);
  const { rows } = await db.execute<
    Omit<SlideFeedbackRow, "user"> & { userName: string | null; userEmail: string | null; userId: string | null }
  >(sql`
    select f.id, f.seed, f.theme, f.rating, f.comment, f.created_at as "createdAt",
           f.user_id as "userId", u.name as "userName", u.email as "userEmail"
      from ${mimirSlideFeedback} f
      left join ${users} u on u.id = f.user_id
     where ${where}
     order by ${sql.join(order, sql`, `)}
     limit ${limit} offset ${offset}`);
  return toPage(
    rows.map(({ userId, userName, userEmail, ...r }) => ({
      ...r,
      createdAt: new Date(r.createdAt).toISOString(),
      user: userId ? { name: userName, email: userEmail } : null,
    })),
    query.page,
  );
}
