/**
 * Who owes the Canary Wire in a given month. Harness policy is that a rep who
 * hasn't been through bootcamp isn't accountable for it, and Mindtickle has no
 * idea who has, so the Bootcamp classes they attended decide:
 *
 *   - a BTC date, their first: accountable from the month after it, so the
 *     month they spent at bootcamp is never held against them;
 *   - an Exempt track, set by hand on the Cohorts page: accountable in every
 *     month;
 *   - no BTC date, but at Harness (by HiBob's start date) since before the
 *     first BTC on record: accountable in every month. Records start at the
 *     first bootcamp, so anyone who joined earlier has none to find — on
 *     2026-10-05 that was about half of the reps without one, most there for
 *     years;
 *   - otherwise, no BTC date: pre-bootcamp in every month.
 *
 * None of it applies to an edition in `NO_BOOTCAMP_EDITIONS`: SDRs never go
 * to bootcamp, so they owe it from their first full month at Harness, by
 * HiBob's start date — starting October 2nd, from November; October 1st,
 * from October — and, with no start date to go on, in every month.
 *
 * An exception is made on the person's track, not here, so the Canary Wire
 * and the cohorts can't disagree about who has been through bootcamp.
 * Applied when a month is assembled, never when data is pulled, so a past
 * month keeps the answer that was true at the time.
 */

import { NO_BOOTCAMP_EDITIONS } from "@/lib/canary-wire/config";
import { firstFullMonth, monthAfterDay, monthKey } from "@/lib/canary-wire/months";

/**
 * Why someone is or isn't accountable: their bootcamp date or exemption;
 * joining before the first bootcamp on record; no bootcamp on record; or, for an
 * edition that skips bootcamp, their first full month (`first_month`) or no
 * start date to go on (`edition`).
 */
export type ExemptionSource = "bootcamp" | "predates_history" | "no_bootcamp" | "first_month" | "edition";

export type Standing = {
  exempt: boolean;
  /** The first month they count, "September 2026"; "" when none is known yet. */
  from: string;
  source: ExemptionSource;
};

export type Accountability = (email: string, month: string, edition: string) => Standing;

export type History = {
  /** email (lowercased) → the first BTC they attended. */
  btcDates: Map<string, string>;
  /** Lowercased emails whose track is pinned Exempt. */
  exempt: Set<string>;
  /** email (lowercased) → HiBob start date. */
  startDates: Map<string, string>;
  /** The first real BTC date on record, `YYYY-MM-DD`; null with none. */
  historyBegins: string | null;
};

export function accountability({ btcDates, exempt, startDates, historyBegins }: History): Accountability {
  return (email, month, edition) => {
    const key = email.trim().toLowerCase();
    if (NO_BOOTCAMP_EDITIONS.includes(edition)) {
      const started = startDates.get(key);
      const from = started ? firstFullMonth(started) : null;
      if (!from) return { exempt: false, from: "", source: "edition" };
      return { exempt: monthKey(month) < monthKey(from), from, source: "first_month" };
    }
    if (exempt.has(key)) return { exempt: false, from: "", source: "bootcamp" };
    const btc = btcDates.get(key);
    const from = btc ? monthAfterDay(btc) : null;
    if (from) return { exempt: monthKey(month) < monthKey(from), from, source: "bootcamp" };
    const started = startDates.get(key);
    if (started && historyBegins && started < historyBegins) return { exempt: false, from: "", source: "predates_history" };
    return { exempt: true, from: "", source: "no_bootcamp" };
  };
}
