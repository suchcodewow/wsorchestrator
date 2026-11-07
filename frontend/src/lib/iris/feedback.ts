/**
 * Smiley and confused ratings given while taking a Diagnostic test, with any
 * comment, and Diagnostic Settings → Feedback's list of them. The server names
 * the question: the one on screen in the taker's sitting, which the browser is
 * never told the id of. An Assessments Administrator closes one once it is
 * dealt with, and the list leaves closed ones out unless asked.
 */

import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  VIDEO_FEEDBACK_LIMITS,
  VIDEO_FEEDBACK_RATINGS,
  irisAttempts,
  irisFeedback,
  users,
  type VideoFeedbackRating,
} from "@/db/schema";
import type { SittingMode } from "@/lib/iris/attempts";
import { ITEMS_BY_ID } from "@/lib/iris/reviews";
import type { SubjectKey } from "@/lib/iris/subjects";
import type { IrisFeedbackSort } from "@/lib/list-specs";
import { pageWindow, toPage, type ListQuery, type Page } from "@/lib/paging";
import { orderFor, searchAny } from "@/lib/paging-sql";

export const irisFeedbackSchema = z.object({
  attemptId: z.string().uuid(),
  number: z.number().int().min(1).max(100),
  rating: z.enum(VIDEO_FEEDBACK_RATINGS),
  comment: z
    .string()
    .trim()
    .max(VIDEO_FEEDBACK_LIMITS.comment)
    .optional()
    .transform((c) => c || null),
});

export type IrisFeedbackInput = z.infer<typeof irisFeedbackSchema>;

export type IrisFeedbackRow = {
  id: string;
  subject: SubjectKey;
  mode: SittingMode;
  number: number;
  itemId: string;
  stem: string;
  rating: VideoFeedbackRating;
  comment: string | null;
  createdAt: string;
  user: { name: string | null; email: string | null } | null;
  closedAt: string | null;
  /** Who closed it; null while open, or once their account is deleted. */
  closedBy: { name: string | null; email: string | null } | null;
};

/**
 * - `not_found` — no sitting of theirs has that id, or not one they may carry on.
 * - `finished`  — it is over, so no question is on screen.
 * - `stale`     — `number` is no longer the question on screen.
 */
export type IrisFeedbackError = "not_found" | "finished" | "stale";

/** A rating of the question on screen in one of `userId`'s own sittings. */
export async function recordIrisFeedback(
  userId: string,
  input: IrisFeedbackInput,
  modes: readonly SittingMode[],
): Promise<{ ok: true; feedback: IrisFeedbackRow } | { ok: false; error: IrisFeedbackError }> {
  const [attempt] = await db
    .select()
    .from(irisAttempts)
    .where(and(eq(irisAttempts.id, input.attemptId), eq(irisAttempts.userId, userId)));
  if (!attempt || !modes.includes(attempt.mode as SittingMode)) return { ok: false, error: "not_found" };
  if (attempt.finishedAt || !attempt.currentItemId) return { ok: false, error: "finished" };
  const item = ITEMS_BY_ID.get(attempt.currentItemId);
  if (!item) return { ok: false, error: "not_found" };
  if (attempt.questions + 1 !== input.number) return { ok: false, error: "stale" };

  const [row] = await db
    .insert(irisFeedback)
    .values({
      userId,
      attemptId: attempt.id,
      subject: attempt.subject,
      mode: attempt.mode,
      number: input.number,
      itemId: item.id,
      itemVersion: item.version,
      stem: item.stem,
      rating: input.rating,
      comment: input.comment,
    })
    .returning();
  const [who] = await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, userId));
  return {
    ok: true,
    feedback: {
      id: row!.id,
      subject: row!.subject as SubjectKey,
      mode: row!.mode as SittingMode,
      number: row!.number,
      itemId: row!.itemId,
      stem: row!.stem,
      rating: row!.rating,
      comment: row!.comment,
      createdAt: row!.createdAt.toISOString(),
      user: who ?? null,
      closedAt: null,
      closedBy: null,
    },
  };
}

const SORT_COLUMNS: Record<IrisFeedbackSort, ReturnType<typeof sql>> = {
  createdAt: sql`f.created_at`,
  user: sql`lower(coalesce(nullif(u.name, ''), u.email))`,
  subject: sql`f.subject`,
  rating: sql`f.rating`,
};

/**
 * The ratings given during a sitting, a page at a time, searched by the
 * comment, the question, or who gave it; the open ones only, unless `closed`.
 */
export async function listIrisFeedback(
  query: ListQuery<IrisFeedbackSort>,
  { closed = false }: { closed?: boolean } = {},
): Promise<Page<IrisFeedbackRow>> {
  const { limit, offset } = pageWindow(query.page);
  const search = searchAny(query.q, [sql`f.comment`, sql`f.stem`, sql`f.item_id`, sql`u.name`, sql`u.email`]) ?? sql`true`;
  const where = closed ? search : sql`${search} and f.closed_at is null`;
  const order = orderFor(SORT_COLUMNS[query.sort], query.dir, sql`f.created_at desc`, sql`f.id`);
  const { rows } = await db.execute<
    Omit<IrisFeedbackRow, "user" | "closedBy"> & {
      userName: string | null;
      userEmail: string | null;
      userId: string | null;
      closerId: string | null;
      closerName: string | null;
      closerEmail: string | null;
    }
  >(sql`
    select f.id, f.subject, f.mode, f.number, f.item_id as "itemId", f.stem, f.rating, f.comment,
           f.created_at as "createdAt", f.user_id as "userId", u.name as "userName", u.email as "userEmail",
           f.closed_at as "closedAt", f.closed_by as "closerId", c.name as "closerName", c.email as "closerEmail"
      from ${irisFeedback} f
      left join ${users} u on u.id = f.user_id
      left join ${users} c on c.id = f.closed_by
     where ${where}
     order by ${sql.join(order, sql`, `)}
     limit ${limit} offset ${offset}`);
  return toPage(
    rows.map(({ userId, userName, userEmail, closerId, closerName, closerEmail, ...r }) => ({
      ...r,
      createdAt: new Date(r.createdAt).toISOString(),
      user: userId ? { name: userName, email: userEmail } : null,
      closedAt: r.closedAt ? new Date(r.closedAt).toISOString() : null,
      closedBy: closerId ? { name: closerName, email: closerEmail } : null,
    })),
    query.page,
  );
}

/** Closes a rating as `userId`, or opens it again; false when there is no such rating. */
export async function setIrisFeedbackClosed(id: string, userId: string, closed: boolean): Promise<boolean> {
  const updated = await db
    .update(irisFeedback)
    .set(closed ? { closedAt: new Date(), closedBy: userId } : { closedAt: null, closedBy: null })
    .where(eq(irisFeedback.id, id))
    .returning({ id: irisFeedback.id });
  return updated.length > 0;
}
