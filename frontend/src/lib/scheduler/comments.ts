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
import {
  SCHEDULE_LIMITS,
  bootcamps,
  scheduleCommentMentions,
  scheduleSessionComments,
  scheduleSessions,
  users,
  type ScheduleTrack,
} from "@/db/schema";
import { noteAudit } from "@/lib/audit-context";
import type { MyMentionSort, SessionCommentSort } from "@/lib/list-specs";
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
  from ${scheduleCommentMentions} m where m.comment_id = ${scheduleSessionComments}.id
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
  const wanted = [...new Set(input.mentions ?? [])];
  let tagged: MentionPick[] = [];
  if (wanted.length > 0) {
    const pool = new Map((await instructorPool(bootcampId)).map((i) => [i.email, i]));
    const stranger = wanted.find((e) => !pool.has(e));
    if (stranger) return { ok: false, error: "not_instructor", email: stranger };
    tagged = wanted.map((e) => ({ email: e, fullName: pool.get(e)!.fullName }));
  }

  const [author] = await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, actorId));
  const row = await db.transaction(async (tx) => {
    const [comment] = await tx
      .insert(scheduleSessionComments)
      .values({
        sessionId,
        body: input.body,
        authorId: actorId,
        authorName: author?.name ?? "",
        authorEmail: author?.email?.toLowerCase() ?? "",
      })
      .returning({ id: scheduleSessionComments.id });
    if (tagged.length > 0) {
      await tx.insert(scheduleCommentMentions).values(tagged.map((m) => ({ commentId: comment!.id, email: m.email, fullName: m.fullName })));
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

// ─── Where one person is tagged ────────────────────────────────────────────

export type MyMentionRow = CommentRow & {
  /** The mention's own id. */
  mentionId: string;
  bootcampId: string;
  bootcampStartDate: string;
  sessionId: string;
  sessionName: string;
  track: ScheduleTrack;
  day: number;
};

const MY_SORT_COLUMNS = {
  createdAt: scheduleSessionComments.createdAt,
  author: SORT_COLUMNS.author,
} as const;

/** One page of the comments that tag `email`, across every bootcamp; the search matches the text, the author or the session. */
export async function listMyMentions(email: string | null, query: ListQuery<MyMentionSort>): Promise<Page<MyMentionRow>> {
  if (!email) return { rows: [], page: query.page, hasMore: false };
  const { limit, offset } = pageWindow(query.page);
  const rows = await db
    .select({
      ...COLUMNS,
      mentionId: scheduleCommentMentions.id,
      bootcampId: scheduleSessions.bootcampId,
      bootcampStartDate: bootcamps.startDate,
      sessionId: scheduleSessions.id,
      sessionName: scheduleSessions.name,
      track: scheduleSessions.track,
      day: scheduleSessions.day,
    })
    .from(scheduleCommentMentions)
    .innerJoin(scheduleSessionComments, eq(scheduleSessionComments.id, scheduleCommentMentions.commentId))
    .innerJoin(scheduleSessions, eq(scheduleSessions.id, scheduleSessionComments.sessionId))
    .innerJoin(bootcamps, eq(bootcamps.id, scheduleSessions.bootcampId))
    .where(
      and(
        eq(scheduleCommentMentions.email, email.toLowerCase()),
        searchAny(query.q, [
          scheduleSessionComments.body,
          scheduleSessionComments.authorName,
          scheduleSessionComments.authorEmail,
          scheduleSessions.name,
        ]),
      ),
    )
    .orderBy(...orderFor(MY_SORT_COLUMNS[query.sort], query.dir, sql`${scheduleSessionComments.createdAt} desc`, scheduleCommentMentions.id))
    .limit(limit)
    .offset(offset);
  return toPage(rows, query.page);
}

/** How many comments tag `email` in all, for the inbox's heading. */
export async function myMentionCount(email: string | null): Promise<number> {
  if (!email) return 0;
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(scheduleCommentMentions)
    .where(eq(scheduleCommentMentions.email, email.toLowerCase()));
  return row?.n ?? 0;
}
