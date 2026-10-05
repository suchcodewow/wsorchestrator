/**
 * Who a session is taught to: its class's current candidates on the tracks
 * its audience takes in, as eVals scores them (see `scoring.ts`). Bootcamp and
 * SE Bootcamp draw on bootcamp candidates, Intermediate and SE Intermediate on
 * intermediate ones. Undecided and deferred people are not in the training.
 */

import "server-only";

import { and, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { AUDIENCE_TRACKS, SCHEDULE_LIMITS, bootcampHistory, employees, type ScheduleTrack, type SessionAudience } from "@/db/schema";
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
const h = bootcampHistory;

/**
 * The attendees a session on `track` for `audience` is taught to, by name,
 * at most `SCHEDULE_LIMITS.groupPeople` of them; `hasMore` when there are more.
 */
export async function classAttendees(
  track: ScheduleTrack,
  audience: SessionAudience,
): Promise<{ attendees: GroupAttendee[]; hasMore: boolean }> {
  const cutoffs = await getCandidateCutoffs();
  const rows = await db
    .select({ email: e.email, fullName: e.fullName, title: e.title, track: sql<"sales" | "engineer">`${e.track}` })
    .from(e)
    .leftJoin(h, sql`${h.email} = ${e.email}`)
    .where(and(isCandidate(cutoffs), IN_STAGE[stageOf(track)], inArray(e.track, [...AUDIENCE_TRACKS[audience]])))
    .orderBy(sql`lower(${e.fullName})`, e.email)
    .limit(SCHEDULE_LIMITS.groupPeople + 1);
  // HiBob can list one email twice; the first by name wins.
  const byEmail = new Map<string, GroupAttendee>();
  for (const r of rows) if (!byEmail.has(r.email)) byEmail.set(r.email, r);
  const attendees = [...byEmail.values()];
  return { attendees: attendees.slice(0, SCHEDULE_LIMITS.groupPeople), hasMore: rows.length > SCHEDULE_LIMITS.groupPeople };
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
