/**
 * "@" tags as they are stored: one `mentions` row per person tagged in a
 * session comment, a checklist item, or the comment on one criterion of an
 * eVals submission. Who may be tagged depends on where: the bootcamp's
 * Training administrators and guest judges on its schedule, and whoever can
 * score it in eVals, so nobody is tagged in something they cannot open.
 *
 * The inbox lists every tag of one person a page at a time. An eVals tag is
 * listed only while that person can still read eVals, or judges that
 * bootcamp, since the comment is about an attendee's performance.
 */

import "server-only";

import { and, eq, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  bootcampJudges,
  bootcamps,
  employees,
  evalsAssessmentCriteria,
  evalsAssessments,
  evalsSubmissionScores,
  evalsSubmissions,
  mentions,
  scheduleChecklistItems,
  scheduleSessionComments,
  scheduleSessions,
  users,
  type EvalsAssessmentStage,
  type MentionKind,
  type ScheduleTrack,
} from "@/db/schema";
import type { MyMentionSort } from "@/lib/list-specs";
import type { MentionPick } from "@/lib/mentions";
import { pageWindow, toPage, type ListQuery, type Page } from "@/lib/paging";
import { orderFor, searchAny } from "@/lib/paging-sql";
import { canUseEvals, type Access } from "@/lib/roles";
import { judgePicks } from "@/lib/scheduler/judges";

/** `emails` as the people in `pool` they name, each once; the first that is not in the pool is refused. */
export function pickMentions(
  pool: MentionPick[],
  emails: string[] | undefined,
): { ok: true; tagged: MentionPick[] } | { ok: false; email: string } {
  const byEmail = new Map(pool.map((p) => [p.email, p]));
  const tagged: MentionPick[] = [];
  for (const email of new Set(emails ?? [])) {
    const p = byEmail.get(email);
    if (!p) return { ok: false, email };
    tagged.push({ email: p.email, fullName: p.fullName });
  }
  return { ok: true, tagged };
}

/** Who is tagging, as a mention row keeps them. */
export async function taggerOf(actorId: string): Promise<{ taggedBy: string; taggedByName: string; taggedByEmail: string }> {
  const [u] = await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, actorId));
  return { taggedBy: actorId, taggedByName: u?.name ?? "", taggedByEmail: u?.email?.toLowerCase() ?? "" };
}

/** Who can be tagged in an eVals comment at a bootcamp: anyone in eVals, and its guest judges. */
export async function scorerPool(bootcampId: string): Promise<MentionPick[]> {
  const [people, judges] = await Promise.all([
    db
      .select({ email: sql<string>`lower(${users.email})`, name: users.name })
      .from(users)
      .where(and(sql`${users.email} is not null`, or(sql`${users.evalsRole} is not null`, eq(users.isPlatformAdmin, true))))
      .orderBy(sql`lower(coalesce(nullif(${users.name}, ''), ${users.email}))`)
      .limit(100),
    judgePicks(bootcampId),
  ]);
  const pool = new Map<string, MentionPick>();
  for (const p of people) pool.set(p.email, { email: p.email, fullName: p.name || p.email });
  for (const j of judges) if (!pool.has(j.email)) pool.set(j.email, { email: j.email, fullName: j.fullName || j.email });
  return [...pool.values()];
}

/**
 * Everyone tagged in the same thing as the `mentions` row in scope, as JSON:
 * the inbox draws each tag in a row's text, not only the viewer's.
 */
const siblingsJson = sql<MentionPick[]>`coalesce((
  select json_agg(json_build_object('email', o.email, 'fullName', o.full_name) order by o.full_name, o.email)
  from ${mentions} o
  where o.comment_id = ${mentions.commentId}
     or o.checklist_item_id = ${mentions.checklistItemId}
     or (o.submission_id = ${mentions.submissionId} and o.criterion_id = ${mentions.criterionId})
), '[]'::json)`;

// ─── Where one person is tagged ────────────────────────────────────────────

export type MyMentionRow = {
  /** The mention's own id. */
  mentionId: string;
  kind: MentionKind;
  /** The comment, or the checklist item's name. */
  text: string;
  /** Everyone it tags, the viewer among them. */
  mentions: MentionPick[];
  taggedByName: string;
  taggedByEmail: string;
  createdAt: Date;
  bootcampId: string;
  bootcampStartDate: string;
  /** A session comment's or a checklist item's; null for an eVals comment. */
  track: ScheduleTrack | null;
  day: number | null;
  /** A session comment's. */
  sessionId: string | null;
  sessionName: string | null;
  /** An eVals comment's. */
  assessmentId: string | null;
  assessmentName: string | null;
  stage: EvalsAssessmentStage | null;
  criterionName: string | null;
  attendeeEmail: string | null;
  attendeeName: string | null;
  /** The attendee's HiBob id, for the scoring form; null if they have left the employee list. */
  employeeId: string | null;
};

export type MentionViewer = { email: string | null; access: Access };

// The employee list keys people by HiBob id, not email, so the attendee is the first with the submission's email.
const attendeeOf = (column: "id" | "full_name") =>
  sql<string | null>`(select e.${sql.raw(column)} from ${employees} e where e.email = ${evalsSubmissions.attendeeEmail} order by e.id limit 1)`;
const attendeeId = attendeeOf("id");
const attendeeName = attendeeOf("full_name");

const tagger = sql`lower(coalesce(nullif(${mentions.taggedByName}, ''), ${mentions.taggedByEmail}))`;

const MY_SORT_COLUMNS = {
  createdAt: mentions.createdAt,
  author: tagger,
} as const;

/** Mentions of the viewer they may still read: an eVals one only while they are in eVals or judge that bootcamp. */
function viewerCondition(viewer: { email: string; access: Access }) {
  const email = viewer.email.toLowerCase();
  return and(
    eq(mentions.email, email),
    canUseEvals(viewer.access)
      ? undefined
      : sql`(${mentions.submissionId} is null or exists (
          select 1 from ${bootcampJudges} j where j.bootcamp_id = ${mentions.bootcampId} and j.email = ${email}
        ))`,
  );
}

/** One page of where the viewer is tagged, across every bootcamp; the search matches the text, who tagged them, or where. */
export async function listMyMentions(viewer: MentionViewer, query: ListQuery<MyMentionSort>): Promise<Page<MyMentionRow>> {
  if (!viewer.email) return { rows: [], page: query.page, hasMore: false };
  const { limit, offset } = pageWindow(query.page);
  const text = sql<string>`coalesce(${scheduleSessionComments.body}, ${scheduleChecklistItems.name}, ${evalsSubmissionScores.comment}, '')`;
  const rows = await db
    .select({
      mentionId: mentions.id,
      kind: sql<MentionKind>`case
        when ${mentions.commentId} is not null then 'comment'
        when ${mentions.checklistItemId} is not null then 'checklist'
        else 'score' end`,
      text,
      mentions: siblingsJson,
      taggedByName: mentions.taggedByName,
      taggedByEmail: mentions.taggedByEmail,
      createdAt: mentions.createdAt,
      bootcampId: mentions.bootcampId,
      bootcampStartDate: bootcamps.startDate,
      track: sql<ScheduleTrack | null>`coalesce(${scheduleSessions.track}, ${scheduleChecklistItems.track})`,
      day: sql<number | null>`coalesce(${scheduleSessions.day}, ${scheduleChecklistItems.day})`,
      sessionId: scheduleSessions.id,
      sessionName: scheduleSessions.name,
      assessmentId: evalsSubmissions.assessmentId,
      assessmentName: evalsSubmissions.assessmentName,
      stage: evalsAssessments.stage,
      criterionName: sql<string | null>`coalesce(${evalsSubmissionScores.criterionName}, ${evalsAssessmentCriteria.name})`,
      attendeeEmail: evalsSubmissions.attendeeEmail,
      attendeeName: sql<string | null>`coalesce(nullif(${attendeeName}, ''), ${evalsSubmissions.attendeeEmail})`,
      employeeId: attendeeId,
    })
    .from(mentions)
    .innerJoin(bootcamps, eq(bootcamps.id, mentions.bootcampId))
    .leftJoin(scheduleSessionComments, eq(scheduleSessionComments.id, mentions.commentId))
    .leftJoin(scheduleSessions, eq(scheduleSessions.id, scheduleSessionComments.sessionId))
    .leftJoin(scheduleChecklistItems, eq(scheduleChecklistItems.id, mentions.checklistItemId))
    .leftJoin(evalsSubmissions, eq(evalsSubmissions.id, mentions.submissionId))
    .leftJoin(evalsAssessments, eq(evalsAssessments.id, evalsSubmissions.assessmentId))
    .leftJoin(evalsAssessmentCriteria, eq(evalsAssessmentCriteria.id, mentions.criterionId))
    .leftJoin(
      evalsSubmissionScores,
      and(eq(evalsSubmissionScores.submissionId, mentions.submissionId), eq(evalsSubmissionScores.criterionId, mentions.criterionId)),
    )
    .where(
      and(
        viewerCondition({ email: viewer.email, access: viewer.access }),
        searchAny(query.q, [
          text,
          mentions.taggedByName,
          mentions.taggedByEmail,
          scheduleSessions.name,
          evalsSubmissions.assessmentName,
          attendeeName,
        ]),
      ),
    )
    .orderBy(...orderFor(MY_SORT_COLUMNS[query.sort], query.dir, sql`${mentions.createdAt} desc`, mentions.id))
    .limit(limit)
    .offset(offset);
  return toPage(rows, query.page);
}

/** How many places tag the viewer in all, for the inbox's heading. */
export async function myMentionCount(viewer: MentionViewer): Promise<number> {
  if (!viewer.email) return 0;
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(mentions)
    .where(viewerCondition({ email: viewer.email, access: viewer.access }));
  return row?.n ?? 0;
}
