/**
 * Notes on a schedule session, each kept with who wrote it and when. Any
 * Training administrator can add one; only its author can remove it.
 */

import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { SCHEDULE_LIMITS, scheduleSessionComments, users } from "@/db/schema";
import { noteAudit } from "@/lib/audit-context";
import type { SessionCommentSort } from "@/lib/list-specs";
import { pageWindow, toPage, type ListQuery, type Page } from "@/lib/paging";
import { orderFor, searchAny } from "@/lib/paging-sql";

export type CommentRow = {
  id: string;
  body: string;
  authorId: string | null;
  authorName: string;
  authorEmail: string;
  createdAt: Date;
};

const COLUMNS = {
  id: scheduleSessionComments.id,
  body: scheduleSessionComments.body,
  authorId: scheduleSessionComments.authorId,
  authorName: scheduleSessionComments.authorName,
  authorEmail: scheduleSessionComments.authorEmail,
  createdAt: scheduleSessionComments.createdAt,
};

const SORT_COLUMNS = {
  createdAt: scheduleSessionComments.createdAt,
  author: sql`lower(coalesce(nullif(${scheduleSessionComments.authorName}, ''), ${scheduleSessionComments.authorEmail}))`,
} as const;

/** One page of a session's comments, newest first by default; the search matches the text or the author. */
export async function listComments(sessionId: string, query: ListQuery<SessionCommentSort>): Promise<Page<CommentRow>> {
  const { limit, offset } = pageWindow(query.page);
  const rows = await db
    .select(COLUMNS)
    .from(scheduleSessionComments)
    .where(
      and(
        eq(scheduleSessionComments.sessionId, sessionId),
        searchAny(query.q, [scheduleSessionComments.body, scheduleSessionComments.authorName, scheduleSessionComments.authorEmail]),
      ),
    )
    .orderBy(...orderFor(SORT_COLUMNS[query.sort], query.dir, sql`${scheduleSessionComments.createdAt} desc`, scheduleSessionComments.id))
    .limit(limit)
    .offset(offset);
  return toPage(rows, query.page);
}

export const commentInputSchema = z.object({
  body: z.string().trim().min(1).max(SCHEDULE_LIMITS.comment),
});

export async function addComment(
  actorId: string,
  sessionId: string,
  input: z.infer<typeof commentInputSchema>,
): Promise<CommentRow> {
  const [author] = await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, actorId));
  const [row] = await db
    .insert(scheduleSessionComments)
    .values({
      sessionId,
      body: input.body,
      authorId: actorId,
      authorName: author?.name ?? "",
      authorEmail: author?.email?.toLowerCase() ?? "",
    })
    .returning(COLUMNS);
  noteAudit({ target: row!.id, targetLabel: input.body.slice(0, 80) });
  return row!;
}

/** Removes a comment its author wrote; anyone else's is `not_author`. */
export async function deleteComment(
  actorId: string,
  sessionId: string,
  commentId: string,
): Promise<{ ok: true } | { ok: false; error: "not_found" | "not_author" }> {
  const [row] = await db
    .select({ authorId: scheduleSessionComments.authorId, body: scheduleSessionComments.body })
    .from(scheduleSessionComments)
    .where(and(eq(scheduleSessionComments.id, commentId), eq(scheduleSessionComments.sessionId, sessionId)));
  if (!row) return { ok: false, error: "not_found" };
  noteAudit({ target: commentId, targetLabel: row.body.slice(0, 80) });
  if (row.authorId !== actorId) return { ok: false, error: "not_author" };
  await db.delete(scheduleSessionComments).where(eq(scheduleSessionComments.id, commentId));
  return { ok: true };
}
