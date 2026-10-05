/**
 * Who owes the Canary Wire in a given month. Harness policy is that a rep who
 * hasn't been through bootcamp isn't accountable for it, and Mindtickle has no
 * idea who has, so bootcamp history decides:
 *
 *   - a BTC date: accountable from the month after it, so the month they spent
 *     at bootcamp is never held against them;
 *   - BTC marked exempt (`EXEMPT_DATE`): accountable in every month;
 *   - no BTC date, but at Harness (by HiBob's start date) since before bootcamp
 *     history begins: accountable in every month. Bootcamp history starts at
 *     its first bootcamp, so anyone who joined earlier has no record to find —
 *     on 2026-10-05 that was about half of the reps without one, most there
 *     for years;
 *   - otherwise, no BTC date: pre-bootcamp in every month.
 *
 * None of it applies to an edition in `NO_BOOTCAMP_EDITIONS`: SDRs never go
 * to bootcamp, so they owe it from their first full month at Harness, by
 * HiBob's start date — starting October 2nd, from November; October 1st,
 * from October — and, with no start date to go on, in every month.
 *
 * An exception is made in bootcamp history itself, not here, so the Canary
 * Wire and the cohorts can't disagree about who has been through bootcamp.
 * Applied when a month is assembled, never when data is pulled, so a past
 * month keeps the answer that was true at the time.
 */

import { EXEMPT_DATE } from "@/db/schema";
import { NO_BOOTCAMP_EDITIONS } from "@/lib/canary-wire/config";
import { firstFullMonth, monthAfterDay, monthKey } from "@/lib/canary-wire/months";

/**
 * Why someone is or isn't accountable: their bootcamp date or exemption;
 * joining before bootcamp history began; no bootcamp on record; or, for an
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
  /** email (lowercased) → BTC date, as bootcamp history has it. */
  btcDates: Map<string, string>;
  /** email (lowercased) → HiBob start date. */
  startDates: Map<string, string>;
  /** The first real BTC date on record, `YYYY-MM-DD`; null with none. */
  historyBegins: string | null;
};

export function accountability({ btcDates, startDates, historyBegins }: History): Accountability {
  return (email, month, edition) => {
    const key = email.trim().toLowerCase();
    if (NO_BOOTCAMP_EDITIONS.includes(edition)) {
      const started = startDates.get(key);
      const from = started ? firstFullMonth(started) : null;
      if (!from) return { exempt: false, from: "", source: "edition" };
      return { exempt: monthKey(month) < monthKey(from), from, source: "first_month" };
    }
    const btc = btcDates.get(key);
    if (btc === EXEMPT_DATE) return { exempt: false, from: "", source: "bootcamp" };
    const from = btc ? monthAfterDay(btc) : null;
    if (from) return { exempt: monthKey(month) < monthKey(from), from, source: "bootcamp" };
    const started = startDates.get(key);
    if (started && historyBegins && started < historyBegins) return { exempt: false, from: "", source: "predates_history" };
    return { exempt: true, from: "", source: "no_bootcamp" };
  };
}
