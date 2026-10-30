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
  /** From 1 to 4, to one decimal place; null when unscored. */
  score: number | null;
  exercises: { name: string; score: number }[];
};

export const NOT_ATTENDED: ClassSummary = { date: null, score: null, exercises: [] };
