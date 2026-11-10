/**
 * Adding someone to the current cohort by hand, from the Cohorts page's Add
 * attendee: a one-off attendee the cohort's rules leave out. They are added
 * to Bootcamp or Intermediate on the Sales or Engineer track, and from then on
 * count as a candidate everywhere the cohort is drawn (`isCandidate`), as
 * anyone else does: one added to Bootcamp carries on to Intermediate after
 * it. Their track is pinned as if set from the track menu, which can change it
 * later like anyone else's.
 *
 * Bootcamp is for someone who has not attended a BTC class; Intermediate for
 * someone who has attended BTC and not INT. Anything else is refused, as is
 * someone the rules already put in the cohort.
 */

import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { cohortAdditions, employees, users, type CohortAdditionTrack } from "@/db/schema";
import { attended, classDate } from "@/lib/evals/attendance";
import { isCandidate, type CandidateStage } from "@/lib/evals/current-cohort";
import { getCandidateCutoffs } from "@/lib/evals/settings";
import { pin, retrackEmployees, unpin } from "@/lib/evals/tracks";

export type AddAttendeeError =
  /** No one in the employee list has that email. */
  | "not_an_employee"
  /** They have attended a class of the stage they were being added to; `date` says when. */
  | "already_attended"
  /** Added to Intermediate without having attended Bootcamp. */
  | "no_bootcamp"
  /** The cohort's rules already put them in this stage on the Sales or Engineer track. */
  | "already_in_cohort";

export type AddAttendeeResult =
  | { ok: true; email: string; fullName: string; stage: CandidateStage; track: CohortAdditionTrack }
  | { ok: false; error: AddAttendeeError; date?: string | null };

const e = employees;
/** Their email as the cohort keys it, lowercased. */
const lowerEmail = sql`lower(${e.email})`;

/**
 * Adds `email` to `stage` of the current cohort on `track`, or says why not.
 * Adding someone already added replaces their stage and track.
 */
export async function addAttendee(
  actorId: string,
  input: { email: string; stage: CandidateStage; track: CohortAdditionTrack },
): Promise<AddAttendeeResult> {
  const lower = input.email.trim().toLowerCase();
  const cutoffs = await getCandidateCutoffs();
  const [person] = await db
    .select({
      email: lowerEmail,
      fullName: e.fullName,
      attendedBtc: attended("bootcamp", lowerEmail),
      attendedInt: attended("intermediate", lowerEmail),
      btcDate: classDate("bootcamp", lowerEmail),
      intDate: classDate("intermediate", lowerEmail),
      // In the cohort by its own rules, on a track that is asked to register, before any addition counts.
      byRules: sql<boolean>`(${and(isCandidate(cutoffs, { additions: false }), sql`${e.track} in ('sales', 'engineer')`)})`,
    })
    .from(e)
    .where(and(eq(lowerEmail, lower), eq(e.active, true)))
    .limit(1);
  if (!person) return { ok: false, error: "not_an_employee" };

  if (input.stage === "bootcamp" && person.attendedBtc) return { ok: false, error: "already_attended", date: person.btcDate };
  if (input.stage === "intermediate" && person.attendedInt) return { ok: false, error: "already_attended", date: person.intDate };
  if (input.stage === "intermediate" && !person.attendedBtc) return { ok: false, error: "no_bootcamp" };
  if (person.byRules) return { ok: false, error: "already_in_cohort" };

  await db
    .insert(cohortAdditions)
    .values({ email: lower, stage: input.stage, track: input.track, addedBy: actorId })
    .onConflictDoUpdate({
      target: cohortAdditions.email,
      set: { stage: input.stage, track: input.track, addedBy: actorId, addedAt: new Date() },
    });
  await pin(lower, input.track);
  await retrackEmployees([lower]);
  return { ok: true, email: lower, fullName: person.fullName, stage: input.stage, track: input.track };
}

/** Takes `email` off the current cohort's additions; whether they were on it. Their track, and any pin, goes back to the rules'. */
export async function removeAttendee(email: string): Promise<{ removed: boolean; fullName: string | null }> {
  const lower = email.trim().toLowerCase();
  const rows = await db.delete(cohortAdditions).where(eq(cohortAdditions.email, lower)).returning({ email: cohortAdditions.email });
  if (rows.length === 0) return { removed: false, fullName: null };
  await unpin(lower);
  await retrackEmployees([lower]);
  const [person] = await db.select({ fullName: e.fullName }).from(e).where(eq(lowerEmail, lower)).limit(1);
  return { removed: true, fullName: person?.fullName ?? null };
}

/** Who added `emails` to the cohort and when, by lowercased email, for the Cohorts page to say so. */
export async function additionsOf(
  emails: readonly string[],
): Promise<Map<string, { stage: CandidateStage; addedAt: string; addedBy: string | null }>> {
  const lower = [...new Set(emails.map((x) => x.toLowerCase()))];
  if (lower.length === 0) return new Map();
  const rows = await db
    .select({
      email: cohortAdditions.email,
      stage: cohortAdditions.stage,
      addedAt: cohortAdditions.addedAt,
      addedBy: sql<string | null>`coalesce(nullif(${users.name}, ''), ${users.email})`,
    })
    .from(cohortAdditions)
    .leftJoin(users, eq(users.id, cohortAdditions.addedBy))
    .where(inArray(cohortAdditions.email, lower));
  return new Map(rows.map((r) => [r.email, { stage: r.stage, addedAt: r.addedAt.toISOString(), addedBy: r.addedBy }]));
}
