/**
 * What Claude's review of a transcript does to the scoring form, apart from
 * asking Claude: each criterion's summary goes on a new line after whatever
 * the judge already wrote, marked as Claude's, and nothing is replaced.
 */

/** One criterion's summary, as the review route returns it. */
export type ReviewComment = { criterionId: string; summary: string };

/** What a summary is wrapped in, so a reader can tell Claude's words from the judge's. */
export const AI_START = "[AI start]";
export const AI_END = "[AI END]";

/**
 * `comment` with `summary` on a line of its own after it, between `AI_START`
 * and `AI_END`, within `max` characters. A long summary is shortened so both
 * markers survive, and one with no room left is not added. An empty comment
 * becomes the marked summary alone; an empty summary leaves the comment as it
 * was.
 */
export function appendSummary(comment: string, summary: string, max: number): string {
  const add = summary.trim();
  if (!add) return comment;
  const kept = comment.replace(/\s+$/, "");
  const room = max - (kept ? kept.length + 1 : 0) - `${AI_START}  ${AI_END}`.length;
  const text = add.slice(0, room).trimEnd();
  if (room <= 0 || !text) return comment;
  const note = `${AI_START} ${text} ${AI_END}`;
  return kept ? `${kept}\n${note}` : note;
}
