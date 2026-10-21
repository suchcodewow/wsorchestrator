/**
 * Who a session is taught to: its class's current candidates on the tracks
 * its audience takes in, as eVals scores them (see `scoring.ts`). Bootcamp and
 * SE Bootcamp draw on bootcamp candidates, Intermediate and SE Intermediate on
 * intermediate ones. Undecided and deferred people are not in the training.
 */

import "server-only";

import { and, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  AUDIENCE_TRACKS,
  SCHEDULE_LIMITS,
  SURVEY_LIMITS,
  employees,
  type ScheduleTrack,
  type SessionAudience,
  type SurveyAudience,
} from "@/db/schema";
import { IN_STAGE, isCandidate, type CandidateStage } from "@/lib/evals/current-cohort";
import { getCandidateCutoffs } from "@/lib/evals/settings";
import { stageOf } from "@/lib/scheduler/timeline";

export type GroupAttendee = {
  email: string;
  fullName: string;
  title: string;
  track: "sales" | "engineer";
};

const e = employees;

/**
 * The attendees a session on `track` for `audience` is taught to, by name,
 * at most `SCHEDULE_LIMITS.groupPeople` of them; `hasMore` when there are more.
 */
export async function classAttendees(
  track: ScheduleTrack,
  audience: SessionAudience,
): Promise<{ attendees: GroupAttendee[]; hasMore: boolean }> {
  const { rows, attendees } = await stageAttendees(stageOf(track), AUDIENCE_TRACKS[audience], SCHEDULE_LIMITS.groupPeople);
  return { attendees: attendees.slice(0, SCHEDULE_LIMITS.groupPeople), hasMore: rows > SCHEDULE_LIMITS.groupPeople };
}

/**
 * Everyone on `track` in `stage`'s class, as a daily survey is sent to them,
 * at most `SURVEY_LIMITS.people`; `hasMore` when there are more.
 */
export async function surveyAttendees(
  stage: CandidateStage,
  track: SurveyAudience,
): Promise<{ attendees: GroupAttendee[]; hasMore: boolean }> {
  const { rows, attendees } = await stageAttendees(stage, [track], SURVEY_LIMITS.people);
  return { attendees: attendees.slice(0, SURVEY_LIMITS.people), hasMore: rows > SURVEY_LIMITS.people };
}

/** `stage`'s candidates on `tracks`, by name, fetching one past `limit` rows; `rows` is how many came back. */
async function stageAttendees(
  stage: CandidateStage,
  tracks: readonly ("sales" | "engineer")[],
  limit: number,
): Promise<{ rows: number; attendees: GroupAttendee[] }> {
  const cutoffs = await getCandidateCutoffs();
  const rows = await db
    .select({ email: e.email, fullName: e.fullName, title: e.title, track: sql<"sales" | "engineer">`${e.track}` })
    .from(e)
    .where(and(isCandidate(cutoffs), IN_STAGE[stage], inArray(e.track, [...tracks])))
    .orderBy(sql`lower(${e.fullName})`, e.email)
    .limit(limit + 1);
  // HiBob can list one email twice; the first by name wins.
  const byEmail = new Map<string, GroupAttendee>();
  for (const r of rows) if (!byEmail.has(r.email)) byEmail.set(r.email, r);
  return { rows: rows.length, attendees: [...byEmail.values()] };
}

/** Each stage's attendees on each track, by email, as `classAttendees` finds them. */
export type ClassLists = Record<CandidateStage, Record<"sales" | "engineer", string[]>>;

/** The class lists a bootcamp's breakouts are checked against; an intermediate class it does not hold is empty. */
export async function classLists(holdsIntermediate: boolean): Promise<ClassLists> {
  const emails = async (track: ScheduleTrack, audience: SessionAudience) =>
    (await classAttendees(track, audience)).attendees.map((a) => a.email);
  const [btcSales, btcEng, intSales, intEng] = await Promise.all([
    emails("btc", "sales"),
    emails("btc", "engineers"),
    holdsIntermediate ? emails("int", "sales") : [],
    holdsIntermediate ? emails("int", "engineers") : [],
  ]);
  return { bootcamp: { sales: btcSales, engineer: btcEng }, intermediate: { sales: intSales, engineer: intEng } };
}
