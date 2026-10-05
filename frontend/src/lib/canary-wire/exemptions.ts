/**
 * Who owes the Canary Wire in a given month. Harness policy is that a rep who
 * hasn't been through bootcamp isn't accountable for it, and Mindtickle has no
 * idea who has, so bootcamp history decides:
 *
 *   - a BTC date: accountable from the month after it, so the month they spent
 *     at bootcamp is never held against them;
 *   - BTC marked exempt (`EXEMPT_DATE`): accountable in every month;
 *   - no BTC date, or no record at all: pre-bootcamp in every month.
 *
 * An exemption set by hand (`canary_wire_exemptions`) overrides that for one
 * person: "not yet in any month", or "from this month". It carries a month
 * rather than being a bare flag because deleting a flag would retroactively
 * count every past month against them.
 *
 * Applied when a month is assembled, never when data is pulled, so a past
 * month keeps the answer that was true at the time.
 */

import { EXEMPT_DATE } from "@/db/schema";
import { MONTH_NAMES, isoFromMonth, monthAfterDay, monthFromIso, monthKey } from "@/lib/canary-wire/months";

export type ExemptionSource = "manual" | "bootcamp" | "no_bootcamp";

export type Standing = {
  exempt: boolean;
  /** The first month they count, "September 2026"; "" when none is known yet. */
  from: string;
  source: ExemptionSource;
};

export type Accountability = (email: string, month: string) => Standing;

/**
 * @param overrides email → first accountable month as `YYYY-MM`, or null for none yet
 * @param btcDates email → BTC date as bootcamp history has it
 */
export function accountability(overrides: Map<string, string | null>, btcDates: Map<string, string>): Accountability {
  return (email, month) => {
    const key = email.trim().toLowerCase();
    if (overrides.has(key)) {
      const iso = overrides.get(key);
      const from = iso ? (monthFromIso(iso) ?? "") : "";
      return { exempt: !from || monthKey(month) < monthKey(from), from, source: "manual" };
    }
    const btc = btcDates.get(key);
    if (btc === EXEMPT_DATE) return { exempt: false, from: "", source: "bootcamp" };
    const from = btc ? monthAfterDay(btc) : null;
    if (!from) return { exempt: true, from: "", source: "no_bootcamp" };
    return { exempt: monthKey(month) < monthKey(from), from, source: "bootcamp" };
  };
}

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/;

/** "August 2026", "Aug 2026" or "2026-08" → "2026-08"; null for anything else. */
export function parseMonth(raw: string): string | null {
  // `>` too, for a paste of `"Dana" <dana@harness.io>, August 2026`.
  const text = raw.replace(/^[\s,;:|"'<>]+|[\s,;:|"'<>]+$/g, "");
  if (!text) return null;
  const iso = /^(\d{4})[-/](\d{1,2})$/.exec(text);
  if (iso) {
    const label = monthFromIso(`${iso[1]}-${iso[2]!.padStart(2, "0")}`);
    return label ? isoFromMonth(label) : null;
  }
  const bits = text.toLowerCase().split(/\s+/);
  if (bits.length !== 2 || !/^\d{4}$/.test(bits[1]!) || bits[0]!.length < 3) return null;
  const name = MONTH_NAMES.find((m) => m.toLowerCase().startsWith(bits[0]!));
  return name ? isoFromMonth(`${name} ${bits[1]}`) : null;
}

export type ParsedExemption = { email: string; accountableFrom: string | null };

/**
 * Emails, and any month after each, out of pasted text. Forgiving on
 * purpose: a paste out of a spreadsheet arrives with quoting, tabs, display
 * names and blank rows, and a line that isn't an email is skipped rather than
 * costing the whole list. A month that can't be read leaves "not yet", the
 * safer of the two readings. The last line for an email wins.
 */
export function parseExemptionText(text: string): ParsedExemption[] {
  const out = new Map<string, string | null>();
  for (const whole of text.split(/\r?\n/)) {
    const line = whole.split("#", 1)[0]!.trim();
    const found = EMAIL.exec(line);
    if (!found) continue;
    out.set(found[0].toLowerCase(), parseMonth(line.slice(found.index + found[0].length)));
  }
  return [...out].map(([email, accountableFrom]) => ({ email, accountableFrom }));
}

/** The list as the dialog shows it: one per line, with the month when there is one. */
export function formatExemptionText(rows: ParsedExemption[]): string {
  return rows
    .map((r) => (r.accountableFrom ? `${r.email}, ${monthFromIso(r.accountableFrom) ?? r.accountableFrom}` : r.email))
    .join("\n");
}
