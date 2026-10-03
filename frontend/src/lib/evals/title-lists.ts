/** The title lists, and what a title on each means for its holder. */

import { EVALS_TITLE_LISTS, type EmployeeTrack, type EvalsTitleList } from "@/db/schema";

export const TITLE_LIST_LABELS: Record<EvalsTitleList, string> = {
  sales: "Sales",
  engineer: "Engineer",
  ignored: "Ignored",
};

/** Each list's section id on the Automation tab. */
export const TITLE_LIST_SLUGS: Record<EvalsTitleList, string> = {
  sales: "sales-titles",
  engineer: "engineer-titles",
  ignored: "ignored-titles",
};

export function isTitleList(value: unknown): value is EvalsTitleList {
  return EVALS_TITLE_LISTS.includes(value as EvalsTitleList);
}

/** A title as it is stored: trimmed, inner whitespace collapsed. */
export function cleanTitle(title: string): string {
  return title.replace(/\s+/g, " ").trim();
}

/** How titles are compared, which is case-insensitively. */
export function titleKey(title: string): string {
  return cleanTitle(title).toLowerCase();
}

/**
 * One title per line from a pasted block, cleaned, with blanks and repeats
 * (in any case) dropped. The first spelling of a repeat is the one kept.
 */
export function splitTitles(text: string): string[] {
  const seen = new Set<string>();
  const titles: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const title = cleanTitle(line);
    if (!title || seen.has(title.toLowerCase())) continue;
    seen.add(title.toLowerCase());
    titles.push(title);
  }
  return titles;
}

/** Which list, if any, holds `title`, from a map of `titleKey` to list. */
export function listForTitle(
  title: string,
  lists: ReadonlyMap<string, EvalsTitleList>,
): EvalsTitleList | null {
  const key = titleKey(title);
  return key ? (lists.get(key) ?? null) : null;
}

/**
 * Who is too new to attend the next bootcamp: anyone who started fewer than
 * `days` days before it starts, or after. Null when there is no bootcamp
 * coming, or the window is 0, which turns deferral off.
 */
export type DeferralRule = { bootcampStart: string; days: number };

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whether someone who started on `startDate` (`YYYY-MM-DD`) sits out the bootcamp. A blank start date never does. */
export function isDeferred(startDate: string | null, rule: DeferralRule | null): boolean {
  if (!rule || rule.days <= 0 || !startDate) return false;
  const lead = (Date.parse(rule.bootcampStart) - Date.parse(startDate)) / DAY_MS;
  return Number.isFinite(lead) && lead < rule.days;
}

/** A track an administrator set by hand; a null track keeps the person undecided. */
export type TrackOverride = { track: EmployeeTrack | null };

/**
 * An employee's track, first that applies: none outside the org; the one an
 * administrator set by hand; `exempt` when their bootcamp history says so;
 * `ignored` for a title on the Ignored list; `deferred` when they started
 * too close to the next bootcamp; otherwise their title's list, or none.
 */
export function trackFor(
  person: {
    inOrg: boolean;
    title: string;
    exempt: boolean;
    startDate?: string | null;
    override?: TrackOverride | null;
  },
  lists: ReadonlyMap<string, EvalsTitleList>,
  deferral: DeferralRule | null = null,
): EmployeeTrack | null {
  if (!person.inOrg) return null;
  if (person.override) return person.override.track;
  if (person.exempt) return "exempt";
  const list = listForTitle(person.title, lists);
  if (list === "ignored") return list;
  if (isDeferred(person.startDate ?? null, deferral)) return "deferred";
  return list;
}
