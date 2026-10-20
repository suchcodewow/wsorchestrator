/**
 * The daily session surveys: sent from the scheduler a track-day at a time,
 * filled in by each attendee at /intake, and read back on Survey Results.
 *
 * A survey is one stage's class on one employee track for one day, its SE
 * track included, since they are the same people: Bootcamp Sales, Bootcamp
 * Engineers, and so on. Each person has at most one survey a day, and
 * sending a day again sends no one a second.
 */

import "server-only";

import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  SCHEDULE_TRACKS,
  bootcamps,
  dailySurveyAssignments,
  dailySurveys,
  scheduleSessions,
  type IntakeFormId,
  type ScheduleTrack,
  type SurveyAudience,
  type SurveySession,
  type SurveySessionAnswers,
} from "@/db/schema";
import { noteAudit } from "@/lib/audit-context";
import type { SurveyResponseSort, SurveyResultSort } from "@/lib/list-specs";
import { PAGE_SIZE, pageWindow, toPage, type ListQuery, type Page } from "@/lib/paging";
import { orderFor, searchAny } from "@/lib/paging-sql";
import { surveyAttendees } from "@/lib/scheduler/attendees";
import { TRACK_LABELS, dayDate, stageOf, trackDays } from "@/lib/scheduler/timeline";
import {
  STAGE_TRACKS,
  checkSurveyAnswers,
  surveyAudiencesOf,
  surveyGroupLabel,
  surveySessions,
  type SurveyAnswerProblem,
  type SurveyDayStatus,
  type SurveySubmission,
} from "@/lib/surveys/survey-values";

export type { SurveyDayStatus };

const s = dailySurveys;
const a = dailySurveyAssignments;

export const surveyTrackSchema = z.enum(SCHEDULE_TRACKS);
export const surveyDaySchema = z.number().int().min(1).max(30);
export const assignSurveysSchema = z.object({ track: surveyTrackSchema, day: surveyDaySchema }).strict();

/** Every stage-day of a bootcamp that has been sent a survey: at most two stages of thirty days. */
export async function surveyDays(bootcampId: string): Promise<SurveyDayStatus[]> {
  const rows = await db
    .select({
      stage: s.stage,
      day: s.day,
      audiences: sql<SurveyAudience[]>`array_agg(distinct ${s.audience})`,
      assigned: sql<number>`count(${a.id})::int`,
      answered: sql<number>`count(${a.submittedAt})::int`,
    })
    .from(s)
    .leftJoin(a, eq(a.surveyId, s.id))
    .where(eq(s.bootcampId, bootcampId))
    .groupBy(s.stage, s.day)
    .orderBy(s.stage, s.day);
  return rows;
}

export type AssignError = "not_found" | "no_such_day";

export const ASSIGN_STATUS_FOR: Record<AssignError, number> = { not_found: 404, no_such_day: 404 };

export type AssignedSurvey = {
  id: string;
  audience: SurveyAudience;
  sessions: number;
  /** People sent it by this call; anyone who already had it is not counted. */
  sent: number;
  /** More attendees than one survey takes; those past the limit were not sent it. */
  hasMore: boolean;
};

/**
 * Sends the surveys for day `day` of `track` to everyone it teaches: on a
 * class, its sales attendees and its engineers; on an SE track, its
 * engineers. A survey already made for that day is reused as it is, with
 * the sessions it was made with, so no one is sent a second. One with no
 * sessions to ask about is made but sent to no one.
 */
export async function assignDaySurveys(
  actorId: string | null,
  bootcampId: string,
  track: ScheduleTrack,
  day: number,
): Promise<{ ok: true; value: AssignedSurvey[] } | { ok: false; error: AssignError }> {
  const [bootcamp] = await db
    .select({ startDate: bootcamps.startDate, btcDays: bootcamps.btcDays, intDays: bootcamps.intDays })
    .from(bootcamps)
    .where(eq(bootcamps.id, bootcampId));
  if (!bootcamp) return { ok: false, error: "not_found" };
  if (day > (trackDays(track, bootcamp) ?? 0)) return { ok: false, error: "no_such_day" };

  const stage = stageOf(track);
  const daySessions = await db
    .select({
      id: scheduleSessions.id,
      track: scheduleSessions.track,
      kind: scheduleSessions.kind,
      audience: scheduleSessions.audience,
      name: scheduleSessions.name,
      emoji: scheduleSessions.emoji,
      start: scheduleSessions.start,
      minutes: scheduleSessions.minutes,
    })
    .from(scheduleSessions)
    .where(
      and(
        eq(scheduleSessions.bootcampId, bootcampId),
        inArray(scheduleSessions.track, [...STAGE_TRACKS[stage]]),
        eq(scheduleSessions.day, day),
      ),
    )
    .orderBy(asc(scheduleSessions.start));

  const audiences = surveyAudiencesOf(track);
  const people = await Promise.all(audiences.map((x) => surveyAttendees(stage, x)));

  const value = await db.transaction(async (tx) => {
    const made: AssignedSurvey[] = [];
    for (const [i, audience] of audiences.entries()) {
      await tx
        .insert(s)
        .values({ bootcampId, stage, day, audience, sessions: surveySessions(daySessions, stage, audience), createdBy: actorId })
        .onConflictDoNothing();
      const [survey] = await tx
        .select({ id: s.id, sessions: s.sessions })
        .from(s)
        .where(and(eq(s.bootcampId, bootcampId), eq(s.stage, stage), eq(s.day, day), eq(s.audience, audience)));
      const { attendees, hasMore } = people[i]!;
      let sent = 0;
      if (survey!.sessions.length > 0 && attendees.length > 0) {
        const inserted = await tx
          .insert(a)
          .values(attendees.map((p) => ({ surveyId: survey!.id, email: p.email.toLowerCase(), fullName: p.fullName })))
          .onConflictDoNothing()
          .returning({ id: a.id });
        sent = inserted.length;
      }
      made.push({ id: survey!.id, audience, sessions: survey!.sessions.length, sent, hasMore });
    }
    return made;
  });

  noteAudit({
    target: bootcampId,
    targetLabel: `Daily surveys: ${TRACK_LABELS[track]}, Day ${day} (${dayDate(bootcamp.startDate, day)})`,
    detail: { track, day, surveys: value.map((v) => ({ group: surveyGroupLabel(stage, v.audience), sent: v.sent })) },
  });
  return { ok: true, value };
}

/** One of someone's daily surveys, as their list of forms shows it. */
export type MySurveyListing = {
  id: string;
  stage: IntakeFormId;
  audience: SurveyAudience;
  day: number;
  /** The day it is about, YYYY-MM-DD. */
  date: string;
  sessions: number;
  assignedAt: string;
  submittedAt: string | null;
};

/** `email`'s daily surveys, the unanswered first, at most a page of them. */
export async function listMySurveys(email: string): Promise<MySurveyListing[]> {
  const rows = await db
    .select({
      id: a.id,
      stage: s.stage,
      audience: s.audience,
      day: s.day,
      startDate: bootcamps.startDate,
      sessions: sql<number>`jsonb_array_length(${s.sessions})::int`,
      assignedAt: a.assignedAt,
      submittedAt: a.submittedAt,
    })
    .from(a)
    .innerJoin(s, eq(s.id, a.surveyId))
    .innerJoin(bootcamps, eq(bootcamps.id, s.bootcampId))
    .where(eq(a.email, email.toLowerCase()))
    .orderBy(sql`${a.submittedAt} is not null`, sql`${a.submittedAt} desc`, sql`${bootcamps.startDate} + ${s.day}`, s.stage)
    .limit(PAGE_SIZE);
  return rows.map(({ startDate, assignedAt, submittedAt, ...r }) => ({
    ...r,
    date: dayDate(startDate, r.day),
    assignedAt: assignedAt.toISOString(),
    submittedAt: submittedAt?.toISOString() ?? null,
  }));
}

/** Someone's own daily survey, with the answers they last saved; `answers` is null until they have. */
export type MySurvey = {
  id: string;
  stage: IntakeFormId;
  audience: SurveyAudience;
  day: number;
  date: string;
  sessions: SurveySession[];
  answers: { sessions: SurveySessionAnswers; dayRating: number; dayChange: string } | null;
  submittedAt: string | null;
};

/** The survey `id`, if it was sent to `email`; null otherwise, so no one learns another's survey exists. */
export async function getMySurvey(email: string, id: string): Promise<MySurvey | null> {
  if (!z.string().uuid().safeParse(id).success) return null;
  const [row] = await db
    .select({
      id: a.id,
      stage: s.stage,
      audience: s.audience,
      day: s.day,
      startDate: bootcamps.startDate,
      sessions: s.sessions,
      sessionAnswers: a.sessionAnswers,
      dayRating: a.dayRating,
      dayChange: a.dayChange,
      submittedAt: a.submittedAt,
    })
    .from(a)
    .innerJoin(s, eq(s.id, a.surveyId))
    .innerJoin(bootcamps, eq(bootcamps.id, s.bootcampId))
    .where(and(eq(a.id, id), eq(a.email, email.toLowerCase())));
  if (!row) return null;
  return {
    id: row.id,
    stage: row.stage,
    audience: row.audience,
    day: row.day,
    date: dayDate(row.startDate, row.day),
    sessions: row.sessions,
    answers:
      row.sessionAnswers && row.dayRating !== null
        ? { sessions: row.sessionAnswers, dayRating: row.dayRating, dayChange: row.dayChange }
        : null,
    submittedAt: row.submittedAt?.toISOString() ?? null,
  };
}

export type SaveSurveyError = SurveyAnswerProblem | { problem: "not_found" };

/** Checks `email`'s answers to their survey `id` and keeps them, in place of any they gave before. */
export async function saveMySurvey(
  email: string,
  id: string,
  submission: SurveySubmission,
): Promise<{ ok: true; survey: MySurvey } | { ok: false; error: SaveSurveyError }> {
  const mine = await getMySurvey(email, id);
  if (!mine) return { ok: false, error: { problem: "not_found" } };
  const checked = checkSurveyAnswers(mine.sessions, submission);
  if (!checked.ok) return checked;
  const [row] = await db
    .update(a)
    .set({ sessionAnswers: checked.sessions, dayRating: checked.dayRating, dayChange: checked.dayChange, submittedAt: new Date() })
    .where(eq(a.id, id))
    .returning({ submittedAt: a.submittedAt });
  noteAudit({
    target: id,
    targetLabel: `${surveyGroupLabel(mine.stage, mine.audience)} survey, Day ${mine.day}: ${email.toLowerCase()}`,
  });
  return {
    ok: true,
    survey: {
      ...mine,
      answers: { sessions: checked.sessions, dayRating: checked.dayRating, dayChange: checked.dayChange },
      submittedAt: row!.submittedAt!.toISOString(),
    },
  };
}

/** One daily survey with at least one response, as Survey Results shows it. */
export type SurveyResultCard = {
  id: string;
  bootcampId: string;
  startDate: string;
  stage: IntakeFormId;
  audience: SurveyAudience;
  day: number;
  date: string;
  sessions: number;
  assigned: number;
  responses: number;
  /** The mean of the day-overall ratings. */
  average: number;
};

const responses = sql<number>`count(${a.submittedAt})::int`;
const average = sql<number>`avg(${a.dayRating})::float`;

/** The text a Survey Results search matches: "November 2026 Bootcamp Sales". */
const resultText = sql`to_char(${bootcamps.startDate}, 'FMMonth YYYY') || ' ' || initcap(${s.stage}) || ' ' || case ${s.audience} when 'engineer' then 'Engineers' else 'Sales' end`;

const RESULT_SORTS: Record<SurveyResultSort, ReturnType<typeof sql>> = {
  date: sql`${bootcamps.startDate} + ${s.day}`,
  average,
  responses,
};

/** The daily surveys anyone has answered, a page at a time. */
export async function listSurveyResults(query: ListQuery<SurveyResultSort>): Promise<Page<SurveyResultCard>> {
  const { limit, offset } = pageWindow(query.page);
  const rows = await db
    .select({
      id: s.id,
      bootcampId: s.bootcampId,
      startDate: bootcamps.startDate,
      stage: s.stage,
      audience: s.audience,
      day: s.day,
      sessions: sql<number>`jsonb_array_length(${s.sessions})::int`,
      assigned: sql<number>`count(${a.id})::int`,
      responses,
      average,
    })
    .from(s)
    .innerJoin(bootcamps, eq(bootcamps.id, s.bootcampId))
    .innerJoin(a, eq(a.surveyId, s.id))
    .where(searchAny(query.q, [resultText]))
    .groupBy(s.id, bootcamps.startDate)
    .having(sql`count(${a.submittedAt}) > 0`)
    .orderBy(...orderFor(RESULT_SORTS[query.sort], query.dir, sql`${bootcamps.startDate} desc`, s.day, s.stage, s.audience))
    .limit(limit)
    .offset(offset);
  return toPage(
    rows.map((r) => ({ ...r, date: dayDate(r.startDate, r.day) })),
    query.page,
  );
}

/** One session's ratings across a survey's responses. */
export type SessionSummary = SurveySession & { average: number | null; ratings: number; comments: number };

export type SurveyResult = Omit<SurveyResultCard, "average" | "sessions"> & {
  average: number | null;
  sessions: SessionSummary[];
};

/** A daily survey and how each of its sessions was rated, or null. */
export async function getSurveyResult(id: string): Promise<SurveyResult | null> {
  if (!z.string().uuid().safeParse(id).success) return null;
  const [row] = await db
    .select({
      id: s.id,
      bootcampId: s.bootcampId,
      startDate: bootcamps.startDate,
      stage: s.stage,
      audience: s.audience,
      day: s.day,
      sessions: s.sessions,
      assigned: sql<number>`count(${a.id})::int`,
      responses,
      average: sql<number | null>`avg(${a.dayRating})::float`,
    })
    .from(s)
    .innerJoin(bootcamps, eq(bootcamps.id, s.bootcampId))
    .leftJoin(a, eq(a.surveyId, s.id))
    .where(eq(s.id, id))
    .groupBy(s.id, bootcamps.startDate);
  if (!row) return null;

  // One row per session asked about, which a day caps at `SCHEDULE_LIMITS.sessionsPerDay` a track.
  const answer = sql`answer`;
  const perSession = await db
    .select({
      id: sql<string>`answer.key`,
      average: sql<number>`avg((answer.value->>'rating')::int)::float`,
      ratings: sql<number>`count(*)::int`,
      comments: sql<number>`count(nullif(answer.value->>'feedback', ''))::int`,
    })
    .from(sql`${a}, jsonb_each(${a.sessionAnswers}) as ${answer}`)
    .where(and(eq(a.surveyId, id), isNotNull(a.submittedAt)))
    .groupBy(sql`answer.key`);
  const byId = new Map(perSession.map((p) => [p.id, p]));

  return {
    ...row,
    date: dayDate(row.startDate, row.day),
    sessions: row.sessions.map((x) => {
      const p = byId.get(x.id);
      return { ...x, average: p?.average ?? null, ratings: p?.ratings ?? 0, comments: p?.comments ?? 0 };
    }),
  };
}

/** One person's answers to a daily survey. */
export type SurveyResponseRow = {
  id: string;
  email: string;
  fullName: string;
  submittedAt: string;
  dayRating: number;
  dayChange: string;
  sessions: SurveySessionAnswers;
};

const RESPONSE_SORTS = {
  submittedAt: a.submittedAt,
  fullName: sql`lower(${a.fullName})`,
  dayRating: a.dayRating,
} as const;

/** The answered copies of survey `surveyId`, a page at a time. */
export async function listSurveyResponses(
  surveyId: string,
  query: ListQuery<SurveyResponseSort>,
): Promise<Page<SurveyResponseRow>> {
  const { limit, offset } = pageWindow(query.page);
  const rows = await db
    .select({
      id: a.id,
      email: a.email,
      fullName: a.fullName,
      submittedAt: a.submittedAt,
      dayRating: a.dayRating,
      dayChange: a.dayChange,
      sessions: a.sessionAnswers,
    })
    .from(a)
    .where(and(eq(a.surveyId, surveyId), isNotNull(a.submittedAt), searchAny(query.q, [a.fullName, a.email])))
    .orderBy(...orderFor(RESPONSE_SORTS[query.sort], query.dir, a.email))
    .limit(limit)
    .offset(offset);
  return toPage(
    rows.map((r) => ({
      ...r,
      submittedAt: r.submittedAt!.toISOString(),
      dayRating: r.dayRating ?? 0,
      sessions: r.sessions ?? {},
    })),
    query.page,
  );
}
