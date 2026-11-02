/**
 * The Welcome page's "Running a Live Training Session" steps, as numbers:
 * whether a bootcamp is active, who is in the current cohort, what the active
 * bootcamp's schedule holds and what is wrong with it, and how far scoring
 * has got, and which of its classes have been released to managers. Each
 * part is there only for a caller who may see where it comes from: the
 * Scheduler and Cohorts for Training, eVals for Assessments, Reporting → Live
 * Sessions for the releases.
 */

import "server-only";

import { SCHEDULE_TRACKS, type ScheduleTrack } from "@/db/schema";
import { CURRENT_TRACKS, currentCohortSummary, type CandidateStage } from "@/lib/evals/current-cohort";
import { scoringProgress, type ScoringTally } from "@/lib/evals/scoring";
import { cohortBootcamp } from "@/lib/reporting/bootcamp";
import type { ReleaseStage } from "@/lib/reporting/bootcamp-values";
import { canSeeBootcampRecords, canUseEvals, canUseTraining, type Access } from "@/lib/roles";
import { activeBootcamp, type ActiveBootcamp } from "@/lib/scheduler/bootcamps";
import { scheduleIssues } from "@/lib/scheduler/issues";
import { loadSchedule } from "@/lib/scheduler/schedule";
import { trackDays } from "@/lib/scheduler/timeline";

export type LiveTraining = {
  /** Null without Training access. */
  training: {
    active: ActiveBootcamp | null;
    /** Everyone on the Cohorts page's Current tab, by stage. */
    attendees: Record<CandidateStage, number>;
    /** The active bootcamp's sessions on each track; null for a track it does not hold. Null with no active bootcamp. */
    sessions: Record<ScheduleTrack, number | null> | null;
    /** How many issues the active bootcamp's schedule shows; null with no active bootcamp. */
    issues: number | null;
  } | null;
  /** Null without Assessments access. */
  assessments: Record<ScheduleTrack, ScoringTally> | null;
  /** The active bootcamp's releases; null with no bootcamp active. */
  feedback: {
    /** False when it holds no intermediate class. */
    intermediate: boolean;
    /** When each class's scores were released to managers, as an ISO timestamp; null until then. */
    released: Record<ReleaseStage, string | null>;
  } | null;
};

export function canSeeLiveTraining(access: Access): boolean {
  return canUseTraining(access) || canUseEvals(access);
}

export async function liveTraining(access: Access): Promise<LiveTraining> {
  const [training, assessments, feedback] = await Promise.all([
    canUseTraining(access) ? trainingSteps() : null,
    canUseEvals(access) ? scoringProgress() : null,
    canSeeBootcampRecords(access) ? feedbackStep() : null,
  ]);
  return { training, assessments, feedback };
}

async function feedbackStep(): Promise<LiveTraining["feedback"]> {
  const bootcamp = await cohortBootcamp();
  if (!bootcamp) return null;
  return {
    intermediate: bootcamp.intermediate,
    released: {
      bootcamp: bootcamp.released.bootcamp?.at.toISOString() ?? null,
      intermediate: bootcamp.released.intermediate?.at.toISOString() ?? null,
    },
  };
}

async function trainingSteps(): Promise<NonNullable<LiveTraining["training"]>> {
  const [active, { counts }] = await Promise.all([activeBootcamp(), currentCohortSummary()]);
  const attendees = {
    bootcamp: CURRENT_TRACKS.reduce((n, t) => n + counts.bootcamp[t], 0),
    intermediate: CURRENT_TRACKS.reduce((n, t) => n + counts.intermediate[t], 0),
  };
  const schedule = active ? await loadSchedule(active.id) : null;
  if (!schedule) return { active, attendees, sessions: null, issues: null };

  const sessions = Object.fromEntries(
    SCHEDULE_TRACKS.map((t) => [t, trackDays(t, schedule.bootcamp) === null ? null : schedule.days[t].flat().length]),
  ) as Record<ScheduleTrack, number | null>;
  return { active, attendees, sessions, issues: scheduleIssues(schedule).length };
}
