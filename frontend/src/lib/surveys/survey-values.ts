/**
 * The daily session surveys' fixed questions, who each track's "Assign
 * Surveys" sends one to, which sessions a survey asks about, and the checks
 * on someone's answers. Pure, so the scheduler, the survey at /intake, the
 * results pages and the unit suite share them with the routes.
 */

import { z } from "zod";
import {
  AUDIENCE_TRACKS,
  SURVEY_LIMITS,
  type IntakeFormId,
  type ScheduleTrack,
  type SessionAudience,
  type SessionKind,
  type SurveyAudience,
  type SurveySession,
  type SurveySessionAnswers,
} from "@/db/schema";
import type { CohortChannelKind } from "@/lib/cohorts/slack-plan";
import { stageOf } from "@/lib/scheduler/timeline";

/** The two questions asked about each session, and the two about the day, worded as they are asked. */
export const SURVEY_QUESTIONS = {
  sessionRating: "How would you rate this session?",
  sessionFeedback:
    "What feedback do you have on the above session?  Include any questions you have or points that should have been clarified further.",
  dayRating: "How would you rate the day overall? (including logistics, experience, timing, content etc.)",
  dayChange: "What is one you would change for the day?",
} as const;

/** Every rating runs from 1 to 5. */
export const RATINGS = [1, 2, 3, 4, 5] as const;
export const RATING_LABELS: Record<number, string> = { 1: "Poor", 5: "Excellent" };

export const SURVEY_STAGE_LABELS: Record<IntakeFormId, string> = {
  bootcamp: "Bootcamp",
  intermediate: "Intermediate",
};

export const SURVEY_AUDIENCE_LABELS: Record<SurveyAudience, string> = {
  sales: "Sales",
  engineer: "Engineers",
};

/** The tracks a stage's sessions are on: a class and its SE track, which are the same people. */
export const STAGE_TRACKS: Record<IntakeFormId, readonly ScheduleTrack[]> = {
  bootcamp: ["btc", "btc_se"],
  intermediate: ["int", "int_se"],
};

/** The surveys a track's "Assign Surveys" sends: a class teaches sales and engineers, an SE track engineers alone. */
export function surveyAudiencesOf(track: ScheduleTrack): SurveyAudience[] {
  return track === "btc_se" || track === "int_se" ? ["engineer"] : ["sales", "engineer"];
}

/**
 * The cohort channel a track's surveys are announced in: a class's `sales-`
 * channel, which holds its Engineers as well, or an SE track's `se-` one.
 */
export function surveyChannelKind(track: ScheduleTrack): CohortChannelKind {
  return `${track === "btc_se" || track === "int_se" ? "se" : "sales"}_${stageOf(track)}`;
}

/** The message that announces a day's surveys in the class's channel, linking to /intake. */
export function surveyAnnouncementText(day: number, date: string, link: string): string {
  return `:clipboard: The *Day ${day} survey* is out, for ${surveyDate(date)}. Please take a few minutes to rate each session and the day: <${link}|complete it here>.`;
}

/**
 * `posted`: announced. `dry_run`: the Slack sync is not live. `no_channel`:
 * the sync has not made the channel yet. `not_connected`: there is no Slack
 * token. `failed`: Slack refused it, with its error.
 */
export type SurveySlackOutcome = {
  channel: string;
  status: "posted" | "dry_run" | "no_channel" | "not_connected" | "failed";
  error?: string;
};

/** One stage-day's surveys as the scheduler shows them: which audiences have one, and how many people have answered. */
export type SurveyDayStatus = {
  stage: IntakeFormId;
  day: number;
  audiences: SurveyAudience[];
  assigned: number;
  answered: number;
};

/** Whether `track`'s day `day` has a survey for every audience it teaches. */
export function trackDaySent(days: readonly SurveyDayStatus[], track: ScheduleTrack, day: number): boolean {
  const found = days.find((d) => d.stage === stageOf(track) && d.day === day);
  return Boolean(found) && surveyAudiencesOf(track).every((x) => found!.audiences.includes(x));
}

/** "Bootcamp Sales", "Intermediate Engineers". */
export function surveyGroupLabel(stage: IntakeFormId, audience: SurveyAudience): string {
  return `${SURVEY_STAGE_LABELS[stage]} ${SURVEY_AUDIENCE_LABELS[audience]}`;
}

/** "November 2026", for a bootcamp starting `startDate` (YYYY-MM-DD). */
export function surveyMonth(startDate: string): string {
  return new Date(`${startDate}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** "Monday, November 2", for a day's YYYY-MM-DD. */
export function surveyDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** An average rating to one decimal place, or an em dash for none. */
export function formatAverage(average: number | null): string {
  return average === null ? "—" : average.toFixed(1);
}

type DaySession = {
  id: string;
  track: ScheduleTrack;
  kind: SessionKind;
  audience: SessionAudience;
  name: string;
  emoji: string;
  start: number;
  minutes: number;
};

/**
 * The sessions of one day that a survey for `audience` asks about: those on
 * the stage's tracks that are taught to them, in the order they start. An
 * unstructured session teaches no one, so it is never asked about.
 */
export function surveySessions(sessions: readonly DaySession[], stage: IntakeFormId, audience: SurveyAudience): SurveySession[] {
  const tracks = STAGE_TRACKS[stage];
  return sessions
    .filter((s) => tracks.includes(s.track) && s.kind !== "unstructured" && AUDIENCE_TRACKS[s.audience].includes(audience))
    .sort((a, b) => a.start - b.start || tracks.indexOf(a.track) - tracks.indexOf(b.track))
    .map(({ id, track, name, emoji, start, minutes }) => ({ id, track, name, emoji, start, minutes }));
}

const rating = z.number().int().min(1).max(5);

export const surveySubmissionSchema = z
  .object({
    sessions: z.record(
      z.string().max(64),
      z.object({ rating, feedback: z.string().max(SURVEY_LIMITS.answer).default("") }).strict(),
    ),
    dayRating: rating,
    dayChange: z.string().max(SURVEY_LIMITS.answer).default(""),
  })
  .strict();

export type SurveySubmission = z.infer<typeof surveySubmissionSchema>;

/** `required`: a session went unrated, named by `sessionId`. `unknown_session`: an answer is for a session the survey does not ask about. */
export type SurveyAnswerProblem = { problem: "required" | "unknown_session"; sessionId: string };

/**
 * The answers to keep, from `submission` to a survey asking about `sessions`:
 * one for each session, with its feedback trimmed, or what is wrong with them.
 */
export function checkSurveyAnswers(
  sessions: readonly Pick<SurveySession, "id">[],
  submission: SurveySubmission,
):
  { ok: true; sessions: SurveySessionAnswers; dayRating: number; dayChange: string } | { ok: false; error: SurveyAnswerProblem } {
  const ids = new Set(sessions.map((s) => s.id));
  const extra = Object.keys(submission.sessions).find((id) => !ids.has(id));
  if (extra) return { ok: false, error: { problem: "unknown_session", sessionId: extra } };
  const kept: SurveySessionAnswers = {};
  for (const { id } of sessions) {
    const answer = submission.sessions[id];
    if (!answer) return { ok: false, error: { problem: "required", sessionId: id } };
    kept[id] = { rating: answer.rating, feedback: answer.feedback.trim() };
  }
  return { ok: true, sessions: kept, dayRating: submission.dayRating, dayChange: submission.dayChange.trim() };
}
