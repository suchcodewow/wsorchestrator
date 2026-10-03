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
 * An employee's track: none outside the org; `exempt` when their bootcamp
 * history says so, whatever their title; otherwise their title's list.
 */
export function trackFor(
  person: { inOrg: boolean; title: string; exempt: boolean },
  lists: ReadonlyMap<string, EvalsTitleList>,
): EmployeeTrack | null {
  if (!person.inOrg) return null;
  return person.exempt ? "exempt" : listForTitle(person.title, lists);
}
