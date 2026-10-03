/**
 * The checks a bootcamp history email, date and score must pass, shared by
 * the sheet reader, the API and the edit form.
 */

import { BOOTCAMP_SCORE } from "@/db/schema";

const SCORE_SCALE = 10 ** BOOTCAMP_SCORE.decimals;

/** A score as it is kept and shown: to one decimal place, so 3.25 is 3.3 and 3.0 is 3. */
export function roundScore(score: number): number {
  return Math.round(score * SCORE_SCALE) / SCORE_SCALE;
}

/** Whether `score` is one a class can give, before rounding. */
export function inScoreRange(score: number): boolean {
  return Number.isFinite(score) && score >= BOOTCAMP_SCORE.min && score <= BOOTCAMP_SCORE.max;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The email lowercased and trimmed, or null if it isn't one. */
export function normalEmail(value: string): string | null {
  const email = value.trim().toLowerCase();
  return EMAIL.test(email) ? email : null;
}

/** `YYYY-MM-DD` if it names a real day, otherwise null. */
export function validIso(y: number, m: number, d: number): string | null {
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

/** Whether the text is a `YYYY-MM-DD` real day. */
export function isIsoDay(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return m !== null && validIso(+m[1]!, +m[2]!, +m[3]!) === value;
}
