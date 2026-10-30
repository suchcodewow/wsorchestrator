/**
 * What Claude's review of a transcript does to the scoring form, apart from
 * asking Claude: each criterion's summary goes on a new line after whatever
 * the judge already wrote, and nothing is replaced.
 */

/** One criterion's summary, as the review route returns it. */
export type ReviewComment = { criterionId: string; summary: string };

/**
 * `comment` with `summary` on a line of its own after it, cut to `max`
 * characters. An empty comment becomes the summary alone; an empty summary
 * leaves the comment as it was.
 */
export function appendSummary(comment: string, summary: string, max: number): string {
  const add = summary.trim();
  if (!add) return comment;
  const kept = comment.replace(/\s+$/, "");
  return (kept ? `${kept}\n${add}` : add).slice(0, max);
}
