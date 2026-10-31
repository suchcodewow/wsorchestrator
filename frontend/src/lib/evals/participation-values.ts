/**
 * The rules of participation that decide without the database, shared by the
 * popup, which shows the running score, and the server, which saves it.
 *
 * A participation score comes from net marks, positive minus negative, and
 * goes on the same 1 to 4 as every assessment. It takes no criteria and no
 * feedback rule: a score of 2 from no marks at all has no comment to go with
 * it, and a comment is written only for a side that has marks.
 */

import type { ParticipationPolarity } from "@/db/schema";

/** The net marks each score starts at; anything below `two` scores a 1. */
export type ParticipationBands = { four: number; three: number; two: number };

export const DEFAULT_PARTICIPATION_BANDS: ParticipationBands = { four: 6, three: 2, two: -1 };

/** What someone with no marks scores, whatever the bands: everyone is expected to take part to reach a 3. */
export const NO_MARKS_SCORE = 2;

export type Marked = { polarity: ParticipationPolarity; count: number };

export function bandsInOrder(bands: ParticipationBands): boolean {
  return bands.four > bands.three && bands.three > bands.two;
}

export function hasMarks(marks: readonly Marked[]): boolean {
  return marks.some((m) => m.count > 0);
}

export function netMarks(marks: readonly Marked[]): number {
  return marks.reduce((net, m) => net + (m.polarity === "positive" ? m.count : -m.count), 0);
}

export function participationScore(marks: readonly Marked[], bands: ParticipationBands): number {
  if (!hasMarks(marks)) return NO_MARKS_SCORE;
  const net = netMarks(marks);
  if (net >= bands.four) return 4;
  if (net >= bands.three) return 3;
  if (net >= bands.two) return 2;
  return 1;
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

export type ExistingParticipation = { email: string; positiveFeedback: string; constructiveFeedback: string };

/**
 * Who a press of Generate touches. Anyone marked was there, so they get the
 * assessment even with no other; someone unmarked gets it only if another
 * assessment shows they attended, because a submission counts as attendance
 * when the class is released. It fills what is blank and changes nothing
 * else, so a side with no marks stays blank and a saved score stays.
 */
export function planGeneration(
  marksByEmail: ReadonlyMap<string, NamedMark[]>,
  assessed: ReadonlySet<string>,
  existing: readonly ExistingParticipation[],
  bands: ParticipationBands,
): GenerationPlan[] {
  const saved = new Map(existing.map((x) => [x.email, x]));
  const emails = [...new Set([...marksByEmail.keys(), ...assessed])].sort();
  return emails.flatMap((email) => {
    const marks = marksByEmail.get(email) ?? [];
    const current = saved.get(email);
    const writePositive = marks.some((m) => m.polarity === "positive") && !current?.positiveFeedback.trim();
    const writeConstructive = marks.some((m) => m.polarity === "negative") && !current?.constructiveFeedback.trim();
    if (current && !writePositive && !writeConstructive) return [];
    return [{ email, marks, score: current ? null : participationScore(marks, bands), writePositive, writeConstructive }];
  });
}

/** What the Generate button shows and its confirmation says. */
export function generationCounts(plans: readonly GenerationPlan[]): { comments: number; scores: number } {
  return {
    comments: plans.reduce((n, p) => n + Number(p.writePositive) + Number(p.writeConstructive), 0),
    scores: plans.filter((p) => p.score !== null).length,
  };
}
