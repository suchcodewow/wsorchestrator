/**
 * The rules of an assessment that decide without the database, shared by the
 * scoring form, which shows them as you type, and the server, which enforces
 * them on save.
 */

import type { EvalsAssessmentAudience, EvalsAssessmentStage } from "@/db/schema";

export const STAGE_LABELS: Record<EvalsAssessmentStage, string> = {
  bootcamp: "Bootcamp",
  intermediate: "Intermediate",
};

export const AUDIENCE_LABELS: Record<EvalsAssessmentAudience, string> = {
  sales: "Sales",
  engineer: "Engineer",
  both: "Sales and engineer",
};

/** The tracks an audience takes in; never `deferred` or a missing track, who are not in the training. */
export function tracksFor(audience: EvalsAssessmentAudience): ("sales" | "engineer")[] {
  return audience === "both" ? ["sales", "engineer"] : [audience];
}

export const CRITERION_SCORES = [1, 2, 3, 4] as const;

export function isCriterionScore(value: unknown): value is (typeof CRITERION_SCORES)[number] {
  return CRITERION_SCORES.includes(value as (typeof CRITERION_SCORES)[number]);
}

/** The mean of the scores to one decimal place, as it is stored; null with none. */
export function averageScore(scores: readonly number[]): number | null {
  if (scores.length === 0) return null;
  const sum = scores.reduce((a, b) => a + b, 0);
  return Math.round((sum * 10) / scores.length) / 10;
}

/**
 * The average as the form shows it and the feedback rules read it: the stored
 * one-decimal value rounded to a whole number, so 2.5 is 3 and 3.4 is 3.
 */
export function wholeScore(average: number): number {
  return Math.round(average);
}

export type FeedbackRequirement = "constructive" | "positive" | null;

/** Which feedback box a whole score makes required: 1–2 constructive, 4 positive, 3 neither. */
export function requiredFeedback(whole: number): FeedbackRequirement {
  if (whole <= 2) return "constructive";
  if (whole >= 4) return "positive";
  return null;
}

export const CONSTRUCTIVE_REQUIRED_NOTE =
  "A score of 1 or 2 means this person needs extra help.  Your constructive feedback is required and will be sent to the manager.";

export const POSITIVE_REQUIRED_NOTE =
  "A score of 4 is outstanding!  Your positive feedback is required and will be sent to the manager.";
