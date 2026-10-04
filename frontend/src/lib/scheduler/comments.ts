/**
 * Notes on a schedule session, each kept with who wrote it and when. Any
 * Training administrator can add one; only its author can remove it. A note
 * can tag the bootcamp's administrators and guest judges with "@", and each
 * person tagged finds it in their inbox.
 */

import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { SCHEDULE_LIMITS, mentions, scheduleSessionComments } from "@/db/schema";
import { noteAudit } from "@/lib/audit-context";
import type { SessionCommentSort } from "@/lib/list-specs";
import { pickMentions, taggerOf } from "@/lib/mention-store";
import type { MentionPick } from "@/lib/mentions";
import { pageWindow, toPage, type ListQuery, type Page } from "@/lib/paging";
import { orderFor, searchAny } from "@/lib/paging-sql";
import { instructorPool } from "@/lib/scheduler/schedule";

export type CommentRow = {
  id: string;
  body: string;
  authorId: string | null;
  authorName: string;
  authorEmail: string;
  createdAt: Date;
  /** Whom it tags, by email, with the name its text spells after an "@". */
  mentions: MentionPick[];
};

// Spelled out, as `staffJson` in schedule.ts is: `id` alone would be the mention's own.
const mentionsJson = sql<MentionPick[]>`coalesce((
  select json_agg(json_build_object('email', m.email, 'fullName', m.full_name) order by m.full_name, m.email)
  from ${mentions} m where m.comment_id = ${scheduleSessionComments}.id
), '[]'::json)`;

const COLUMNS = {
  id: scheduleSessionComments.id,
  body: scheduleSessionComments.body,
  authorId: scheduleSessionComments.authorId,
  authorName: scheduleSessionComments.authorName,
  authorEmail: scheduleSessionComments.authorEmail,
  createdAt: scheduleSessionComments.createdAt,
  mentions: mentionsJson,
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
  /** The emails of the people it tags. */
  mentions: z.array(z.string().trim().toLowerCase().max(320)).max(SCHEDULE_LIMITS.mentions).optional(),
});

export async function addComment(
  actorId: string,
  bootcampId: string,
  sessionId: string,
  input: z.infer<typeof commentInputSchema>,
): Promise<{ ok: true; comment: CommentRow } | { ok: false; error: "not_instructor"; email: string }> {
  const picked = input.mentions?.length ? pickMentions(await instructorPool(bootcampId), input.mentions) : { ok: true as const, tagged: [] };
  if (!picked.ok) return { ok: false, error: "not_instructor", email: picked.email };

  const tagger = await taggerOf(actorId);
  const row = await db.transaction(async (tx) => {
    const [comment] = await tx
      .insert(scheduleSessionComments)
      .values({
        sessionId,
        body: input.body,
        authorId: actorId,
        authorName: tagger.taggedByName,
        authorEmail: tagger.taggedByEmail,
      })
      .returning({ id: scheduleSessionComments.id, createdAt: scheduleSessionComments.createdAt });
    if (picked.tagged.length > 0) {
      await tx.insert(mentions).values(
        picked.tagged.map((m) => ({
          commentId: comment!.id,
          bootcampId,
          email: m.email,
          fullName: m.fullName,
          ...tagger,
          createdAt: comment!.createdAt,
        })),
      );
    }
    const [full] = await tx.select(COLUMNS).from(scheduleSessionComments).where(eq(scheduleSessionComments.id, comment!.id));
    return full!;
  });
  noteAudit({ target: row.id, targetLabel: input.body.slice(0, 80) });
  return { ok: true, comment: row };
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
