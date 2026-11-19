/** The rules for a typed Diagnostic answer, shared by the answer box and the server so both refuse the same things. */

/** About 25 words: a short answer, not an essay to hedge in. */
export const TEXT_ANSWER_LIMITS = { chars: 200, words: 25 } as const;

export const wordsIn = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

/** Why `text` cannot be sent as an answer, or null when it can. */
export function textAnswerProblem(text: string): "empty" | "too_long" | null {
  if (!text.trim()) return "empty";
  if (text.trim().length > TEXT_ANSWER_LIMITS.chars || wordsIn(text) > TEXT_ANSWER_LIMITS.words) return "too_long";
  return null;
}
