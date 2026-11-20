/**
 * The rules of participation that decide without the database, shared by the
 * popup and the server.
 *
 * A participation score is set by hand, on the same 1 to 4 as every
 * assessment, from the Administration View. Marks never move it: everyone
 * starts at `DEFAULT_PARTICIPATION_SCORE`. It takes no criteria and no
 * feedback rule, and a comment is written only for a side that has marks.
 */

import type { ParticipationPolarity } from "@/db/schema";

/** What every participation assessment is scored until an administrator changes it. */
export const DEFAULT_PARTICIPATION_SCORE = 3;

export type Marked = { polarity: ParticipationPolarity; count: number };

export function hasMarks(marks: readonly Marked[]): boolean {
  return marks.some((m) => m.count > 0);
}

/** One descriptor marked on one attendee, by name. */
export type NamedMark = Marked & { name: string };

/** What a press of Generate would do for one attendee. */
export type GenerationPlan = {
  email: string;
  marks: NamedMark[];
  /** Null when they already have a score, which Generate leaves alone. */
  score: number | null;
  /** Whether a blank comment on this side has marks to be written from. */
  writePositive: boolean;
  writeConstructive: boolean;
};

export type ExistingParticipation = {
  email: string;
  /** Blank from the first mark until Generate. */
  averageScore: number | null;
  positiveFeedback: string;
  constructiveFeedback: string;
};

/**
 * Who a press of Generate touches. Anyone marked has the assessment already,
 * from their first mark; someone unmarked gets it only if another assessment
 * shows they attended, because a submission counts as attendance when the
 * class is released. It fills what is blank and changes nothing else, so a
 * side with no marks stays blank and a saved score stays.
 */
export function planGeneration(
  marksByEmail: ReadonlyMap<string, NamedMark[]>,
  assessed: ReadonlySet<string>,
  existing: readonly ExistingParticipation[],
): GenerationPlan[] {
  const saved = new Map(existing.map((x) => [x.email, x]));
  const emails = [...new Set([...marksByEmail.keys(), ...assessed])].sort();
  return emails.flatMap((email) => {
    const marks = marksByEmail.get(email) ?? [];
    const current = saved.get(email);
    const writePositive = marks.some((m) => m.polarity === "positive") && !current?.positiveFeedback.trim();
    const writeConstructive = marks.some((m) => m.polarity === "negative") && !current?.constructiveFeedback.trim();
    const scored = current !== undefined && current.averageScore !== null;
    if (scored && !writePositive && !writeConstructive) return [];
    return [{ email, marks, score: scored ? null : DEFAULT_PARTICIPATION_SCORE, writePositive, writeConstructive }];
  });
}

/** What the Generate button shows and its confirmation says. */
export function generationCounts(plans: readonly GenerationPlan[]): { comments: number; scores: number } {
  return {
    comments: plans.reduce((n, p) => n + Number(p.writePositive) + Number(p.writeConstructive), 0),
    scores: plans.filter((p) => p.score !== null).length,
  };
}
