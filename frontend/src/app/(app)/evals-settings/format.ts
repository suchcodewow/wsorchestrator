/** How eVals settings writes dates, scores and lists. */

import { EXEMPT_DATE, type EvalsTitleList } from "@/db/schema";

/** The colour of each list's badge. */
export const LIST_BADGE: Record<EvalsTitleList, string> = {
  sales: "border-transparent bg-sky-500/15 text-sky-700 dark:text-sky-300",
  engineer: "border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  ignored: "border-transparent bg-muted text-muted-foreground",
};

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

export function formatScore(score: number | null): string {
  return score === null ? "—" : String(Math.round(score * 100) / 100);
}
