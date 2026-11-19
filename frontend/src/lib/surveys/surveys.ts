/**
 * The daily session surveys: sent from the scheduler a track-day at a time,
 * filled in by each attendee at /intake, and read back on Survey Results.
 *
 * A survey is one stage's class on one employee track for one day, its SE
 * track included, since they are the same people: Bootcamp Sales, Bootcamp
 * Engineers, and so on. Each person has at most one survey a day, and
 * sending a day again sends no one a second. A day can be unassigned, which
 * hides its surveys from attendees but keeps every answer; assigning it again
 * brings back the answers to sessions that are still on the day.
 */

import "server-only";

import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
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
import { sessionLeaderName } from "@/lib/scheduler/schedule";
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

/** Every stage-day of a bootcamp that is assigned a survey: at most two stages of thirty days. */
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
    .where(and(eq(s.bootcampId, bootcampId), isNull(s.unassignedAt)))
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
  /** Whether this call made it, or brought it back, rather than finding it already assigned. */
  created: boolean;
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
 * sessions to ask about is made but sent to no one. A survey that was
 * unassigned is brought back with the day's sessions as they now stand: an
 * answer to a session still on the day is kept and shown again, and an
 * answer to one that is gone is deleted.
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
      leader: sessionLeaderName,
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
      const fresh = await tx
        .insert(s)
        .values({ bootcampId, stage, day, audience, sessions: surveySessions(daySessions, stage, audience), createdBy: actorId })
        .onConflictDoNothing()
        .returning({ id: s.id });
      const [survey] = await tx
        .select({ id: s.id, sessions: s.sessions, unassignedAt: s.unassignedAt })
        .from(s)
        .where(and(eq(s.bootcampId, bootcampId), eq(s.stage, stage), eq(s.day, day), eq(s.audience, audience)));
      const revived = survey!.unassignedAt !== null;
      if (revived) {
        survey!.sessions = surveySessions(daySessions, stage, audience);
        await tx.update(s).set({ sessions: survey!.sessions, unassignedAt: null }).where(eq(s.id, survey!.id));
        await keepAnswersToSessions(tx, survey!.id, new Set(survey!.sessions.map((x) => x.id)));
      }
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
      made.push({ id: survey!.id, audience, sessions: survey!.sessions.length, created: fresh.length > 0 || revived, sent, hasMore });
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

/**
 * Drops, from every copy of survey `surveyId`, the answers to sessions not in
 * `sessionIds`. A copy left with no answer to any session is reset as if never
 * answered; one that keeps some stays answered.
 */
async function keepAnswersToSessions(tx: Pick<typeof db, "select" | "update">, surveyId: string, sessionIds: Set<string>) {
  const answered = await tx
    .select({ id: a.id, sessionAnswers: a.sessionAnswers })
    .from(a)
    .where(and(eq(a.surveyId, surveyId), isNotNull(a.sessionAnswers)));
  for (const row of answered) {
    const kept = Object.fromEntries(Object.entries(row.sessionAnswers ?? {}).filter(([id]) => sessionIds.has(id)));
    if (Object.keys(kept).length === Object.keys(row.sessionAnswers ?? {}).length) continue;
    await tx
      .update(a)
      .set(
        Object.keys(kept).length > 0
          ? { sessionAnswers: kept }
          : { sessionAnswers: null, dayRating: null, dayChange: "", submittedAt: null },
      )
      .where(eq(a.id, row.id));
  }
}

/**
 * Takes day `day` of `track` back from attendees: its surveys are hidden from
 * them and from the scheduler's sent count, and every answer already given is
 * kept for Survey Results and for the next time the day is assigned.
 */
export async function unassignDaySurveys(
  bootcampId: string,
  track: ScheduleTrack,
  day: number,
): Promise<{ ok: true; value: { unassigned: number } } | { ok: false; error: AssignError }> {
  const [bootcamp] = await db.select({ startDate: bootcamps.startDate }).from(bootcamps).where(eq(bootcamps.id, bootcampId));
  if (!bootcamp) return { ok: false, error: "not_found" };
  const stage = stageOf(track);
  const rows = await db
    .update(s)
    .set({ unassignedAt: new Date() })
    .where(
      and(
        eq(s.bootcampId, bootcampId),
        eq(s.stage, stage),
        eq(s.day, day),
        inArray(s.audience, surveyAudiencesOf(track)),
        isNull(s.unassignedAt),
      ),
    )
    .returning({ id: s.id });
  noteAudit({
    target: bootcampId,
    targetLabel: `Daily surveys unassigned: ${TRACK_LABELS[track]}, Day ${day} (${dayDate(bootcamp.startDate, day)})`,
    detail: { track, day, unassigned: rows.length },
  });
  return { ok: true, value: { unassigned: rows.length } };
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
    .where(and(eq(a.email, email.toLowerCase()), isNull(s.unassignedAt)))
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
    .where(and(eq(a.id, id), eq(a.email, email.toLowerCase()), isNull(s.unassignedAt)));
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
    .set({
      sessionAnswers: checked.sessions,
      dayRating: checked.dayRating,
      dayChange: checked.dayChange,
      submittedAt: new Date(),
    })
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

/** The daily surveys anyone has answered, a page at a time; `today` keeps only the one about today (UTC). */
export async function listSurveyResults(query: ListQuery<SurveyResultSort>, today = false): Promise<Page<SurveyResultCard>> {
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
    .where(
      and(
        searchAny(query.q, [resultText]),
        today ? sql`${bootcamps.startDate} + ${s.day} - 1 = ${new Date().toISOString().slice(0, 10)}::date` : undefined,
      ),
    )
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
export type SessionSummary = SurveySession & {
  average: number | null;
  ratings: number;
  comments: number;
  /** How many rated it 1, 2, 3, 4 and 5, in that order. */
  breakdown: [number, number, number, number, number];
  /** Claude's summary of it, from the last Generate AI Summary; null before one. */
  summary: string | null;
};

export type SurveyResult = Omit<SurveyResultCard, "average" | "sessions"> & {
  average: number | null;
  sessions: SessionSummary[];
  /** When Generate AI Summary last ran on it; null before it has. */
  summarizedAt: string | null;
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
      summaries: s.summaries,
      summarizedAt: s.summarizedAt,
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
      breakdown: sql<[number, number, number, number, number]>`array[
        count(*) filter (where answer.value->>'rating' = '1'), count(*) filter (where answer.value->>'rating' = '2'),
        count(*) filter (where answer.value->>'rating' = '3'), count(*) filter (where answer.value->>'rating' = '4'),
        count(*) filter (where answer.value->>'rating' = '5')]::int[]`,
    })
    .from(sql`${a}, jsonb_each(${a.sessionAnswers}) as ${answer}`)
    .where(and(eq(a.surveyId, id), isNotNull(a.submittedAt)))
    .groupBy(sql`answer.key`);
  const byId = new Map(perSession.map((p) => [p.id, p]));

  const { summaries, summarizedAt, ...rest } = row;
  return {
    ...rest,
    date: dayDate(row.startDate, row.day),
    summarizedAt: summarizedAt?.toISOString() ?? null,
    sessions: row.sessions.map((x) => {
      const p = byId.get(x.id);
      return {
        ...x,
        average: p?.average ?? null,
        ratings: p?.ratings ?? 0,
        comments: p?.comments ?? 0,
        breakdown: p?.breakdown ?? [0, 0, 0, 0, 0],
        summary: summaries[x.id] ?? null,
      };
    }),
  };
}

/** Someone's comment on one session of a survey, with the rating they gave it. */
export type SessionComment = { id: string; email: string; fullName: string; rating: number; feedback: string; submittedAt: string };

/**
 * The comments left on session `sessionId` of survey `surveyId`, the lowest
 * ratings first, at most a page of them; null when there is no such survey.
 */
export async function listSessionComments(
  surveyId: string,
  sessionId: string,
): Promise<{ comments: SessionComment[]; hasMore: boolean } | null> {
  if (!z.string().uuid().safeParse(surveyId).success) return null;
  const [survey] = await db.select({ id: s.id }).from(s).where(eq(s.id, surveyId));
  if (!survey) return null;
  const answer = sql`${a.sessionAnswers}->${sessionId}`;
  const rows = await db
    .select({
      id: a.id,
      email: a.email,
      fullName: a.fullName,
      rating: sql<number>`(${answer}->>'rating')::int`,
      feedback: sql<string>`${answer}->>'feedback'`,
      submittedAt: a.submittedAt,
    })
    .from(a)
    .where(and(eq(a.surveyId, surveyId), isNotNull(a.submittedAt), sql`coalesce(${answer}->>'feedback', '') <> ''`))
    .orderBy(sql`(${answer}->>'rating')::int`, sql`lower(${a.fullName})`, a.email)
    .limit(PAGE_SIZE + 1);
  return {
    comments: rows.slice(0, PAGE_SIZE).map((r) => ({ ...r, submittedAt: r.submittedAt!.toISOString() })),
    hasMore: rows.length > PAGE_SIZE,
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
export async function listSurveyResponses(surveyId: string, query: ListQuery<SurveyResponseSort>): Promise<Page<SurveyResponseRow>> {
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
