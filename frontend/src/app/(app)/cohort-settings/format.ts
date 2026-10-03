/** How eVals settings writes dates, scores and lists. */

import { EXEMPT_DATE } from "@/db/schema";
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

/** A bootcamp date, where 2000-01-01 means the person never needs to attend. */
export function formatHistoryDate(iso: string | null): string {
  return iso === EXEMPT_DATE ? "Exempt" : formatDate(iso);
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
