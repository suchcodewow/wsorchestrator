/**
 * Reporting → Bootcamp's shapes and labels, kept apart from `bootcamp.ts` so
 * the page's client components can use them.
 */

import { EXEMPT_DATE, type EvalsAssessmentStage } from "@/db/schema";

export const RELEASE_STAGES = ["bootcamp", "intermediate"] as const satisfies readonly EvalsAssessmentStage[];
export type ReleaseStage = (typeof RELEASE_STAGES)[number];

export function isReleaseStage(value: unknown): value is ReleaseStage {
  return RELEASE_STAGES.includes(value as ReleaseStage);
}

/** The furthest someone has got: INT, else BTC, else only an exempt marker. */
export const BOOTCAMP_LEVELS = ["intermediate", "bootcamp", "exempt"] as const;
export type BootcampLevel = (typeof BOOTCAMP_LEVELS)[number];

export const STAGE_CODES: Record<ReleaseStage, string> = { bootcamp: "BTC", intermediate: "INT" };

export const RELEASE_LABELS: Record<ReleaseStage, string> = {
  bootcamp: "Release Bootcamp Scores",
  intermediate: "Release Intermediate Scores",
};

/**
 * One class as a manager sees it: when they attended, how they did overall,
 * and how on each exercise. From the newest of their eVals submissions and
 * their bootcamp history row, whichever is the later class.
 */
export type ClassSummary = {
  /** The class's day; `EXEMPT_DATE` for someone exempt; null for someone who has not attended. */
  date: string | null;
  /** From 1 to 4, to one decimal place; null when unscored. */
  score: number | null;
  exercises: { name: string; score: number }[];
};

export const NOT_ATTENDED: ClassSummary = { date: null, score: null, exercises: [] };

export const isExempt = (date: string | null) => date === EXEMPT_DATE;

/** "Score-First Call / EMD", as the Sheet's column was named, less its prefix. */
export function exerciseName(key: string): string {
  return key.replace(/^score-\s*/i, "") || key;
}

/** A bootcamp history row's side of one class. */
export function historyClass(
  date: string | null,
  score: number | null,
  individual: Record<string, number> | null,
): ClassSummary {
  return {
    date,
    score,
    exercises: Object.entries(individual ?? {}).map(([key, value]) => ({ name: exerciseName(key), score: value })),
  };
}
