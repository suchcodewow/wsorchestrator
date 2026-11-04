/** How eVals settings writes dates, scores and lists. */

import { roundScore } from "@/lib/evals/history-values";

const DATE = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

/** A `YYYY-MM-DD` column as "Jun 9, 2026". */
export function formatDate(iso: string | null): string {
  return iso ? DATE.format(new Date(`${iso}T00:00:00Z`)) : "—";
}

const WHEN = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export function formatWhen(iso: string | null): string {
  return iso ? WHEN.format(new Date(iso)) : "—";
}

/** A score to one decimal place, with none for a whole number: "3.3", "4". */
export function formatScore(score: number | null): string {
  return score === null ? "—" : String(roundScore(score));
}

/** A score as a whole number, from its one-decimal value, as Live Sessions shows it: 2.5 is "3". */
export function formatWholeScore(score: number | null): string {
  return score === null ? "—" : String(Math.round(roundScore(score)));
}
