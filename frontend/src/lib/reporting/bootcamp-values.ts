/**
 * Reporting → Bootcamp's shapes and labels, kept apart from `bootcamp.ts` so
 * the page's client components can use them.
 */

import type { EvalsAssessmentStage } from "@/db/schema";

export const RELEASE_STAGES = ["bootcamp", "intermediate"] as const satisfies readonly EvalsAssessmentStage[];
export type ReleaseStage = (typeof RELEASE_STAGES)[number];

export function isReleaseStage(value: unknown): value is ReleaseStage {
  return RELEASE_STAGES.includes(value as ReleaseStage);
}

/** The furthest someone has got: INT, else BTC. */
export const BOOTCAMP_LEVELS = ["intermediate", "bootcamp"] as const;
export type BootcampLevel = (typeof BOOTCAMP_LEVELS)[number];

export const STAGE_CODES: Record<ReleaseStage, string> = { bootcamp: "BTC", intermediate: "INT" };

export const RELEASE_LABELS: Record<ReleaseStage, string> = {
  bootcamp: "Release Bootcamp Scores",
  intermediate: "Release Intermediate Scores",
};

/**
 * One class as a manager sees it: when they attended, how they did overall,
 * and how on each exercise. From their submissions at the newest bootcamp
 * they were scored at in that class.
 */
export type ClassSummary = {
  /** The class's day; null for someone who has not attended. */
  date: string | null;
  /** From 1 to 4, to one decimal place; null when unscored. The exams count as one more exercise. */
  score: number | null;
  /**
   * Each assessment's score, with the feedback a manager reads under it: the
   * positive feedback of one that rounds to 4, the constructive of one that
   * rounds to 1 or 2, and null for a 3.
   */
  exercises: { name: string; score: number; feedback: string | null }[];
  /** An administrator's overall feedback and other notes on the class; empty until written. */
  positiveFeedback: string;
  constructiveFeedback: string;
  otherNotes: string;
  /** The mean of the entrance and exit exams, as a percentage; null until both are in. */
  examAverage: number | null;
};

export const NOT_ATTENDED: ClassSummary = {
  date: null,
  score: null,
  exercises: [],
  positiveFeedback: "",
  constructiveFeedback: "",
  otherNotes: "",
  examAverage: null,
};

/** The mean of the entrance and exit exams, to one decimal place; null unless both are in. */
export function examAverage(entrance: number | null, exit: number | null): number | null {
  if (entrance === null || exit === null) return null;
  return Math.round((entrance + exit) * 5) / 10;
}

/** An exam average on the 1 to 4 scale: 96% and up is 4, 88% is 3, 80% is 2, anything less 1. */
export function examScore(average: number): number {
  if (average >= 96) return 4;
  if (average >= 88) return 3;
  if (average >= 80) return 2;
  return 1;
}

/** The two sides of overall feedback Claude can write. */
export const OVERALL_SIDES = ["positive", "constructive"] as const;
export type OverallSide = (typeof OVERALL_SIDES)[number];
