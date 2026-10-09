/** Who the Guest judges tab counts as a sales or sales engineering leader, and what a guest speaker entry holds. Pure, for the page, the routes and the API reference. */

import { z } from "zod";
import { GUEST_SPEAKER_PROGRAMS, GUEST_SPEAKER_ROLES } from "@/db/schema";

/**
 * HiBob departments whose leaders are asked to judge: sales and sales
 * engineering. A leader is anyone in one of them with a direct report.
 */
export const GUEST_JUDGE_DEPARTMENTS = ["Enterprise Sales", "Corporate Sales", "Sales Engineering"] as const;

/**
 * The two halves of that list the leaders table toggles between, by HiBob
 * department rather than title: a title can leave its department out
 * ("Chief Revenue Officer") or misspell it, a department cannot.
 */
export const PROSPECT_GROUPS = {
  sales: { label: "Enterprise & Corporate Sales", departments: ["Enterprise Sales", "Corporate Sales"] },
  se: { label: "Sales Engineering", departments: ["Sales Engineering"] },
} as const;

export type ProspectGroup = keyof typeof PROSPECT_GROUPS;

export function isProspectGroup(value: unknown): value is ProspectGroup {
  return value === "sales" || value === "se";
}

/** Whole months as "3 yr 2 mo", "11 mo", "Under a month". */
export function formatTenure(months: number | null): string {
  if (months === null) return "—";
  if (months < 1) return "Under a month";
  const years = Math.floor(months / 12);
  const rest = months % 12;
  return [years ? `${years} yr` : "", rest ? `${rest} mo` : ""].filter(Boolean).join(" ");
}

/** The URL prefix the leaders table sorts and pages under, beside the judges table's. */
export const PROSPECTS = "leaders";

/**
 * HiBob's work location for someone, a custom column ("Chicago", "US-Remote")
 * that the sync keeps in the employee's raw record under its id.
 */
export const HIBOB_WORK_LOCATION_COLUMN = "column_1722017397644";

export const GUEST_SPEAKER_LIMITS = { name: 200, session: 200 } as const;

export const PROGRAM_LABELS = { bootcamp: "Bootcamp", intermediate: "Intermediate" } as const;

export const ROLE_LABELS = { teach: "Taught", commentator: "Commentator", judge: "Judge", speaker: "Speaker" } as const;

/** One guest speaker entry as an administrator adds it: `cohort` is the month, `YYYY-MM`. */
export const guestSpeakerSchema = z
  .object({
    cohort: z.string().regex(/^20\d\d-(0[1-9]|1[0-2])$/),
    program: z.enum(GUEST_SPEAKER_PROGRAMS),
    session: z.string().trim().max(GUEST_SPEAKER_LIMITS.session).default(""),
    role: z.enum(GUEST_SPEAKER_ROLES),
    fullName: z.string().trim().min(1).max(GUEST_SPEAKER_LIMITS.name),
    email: z.string().trim().toLowerCase().email().max(320).nullable().default(null),
  })
  .strict();

export type GuestSpeakerInput = z.infer<typeof guestSpeakerSchema>;

/** A month for a cohort as an administrator gives it, `YYYY-MM`. */
export const cohortMonthSchema = z.object({ cohort: z.string().regex(/^20\d\d-(0[1-9]|1[0-2])$/) }).strict();

export type CohortGroup<T> = { month: string; rows: T[] };

/**
 * One page of guest judges, already ordered by month, as the cohorts it
 * heads, with the months set aside for a cohort and no one in them yet put
 * where they fall. An empty month before the page's first cohort shows only
 * on the first page and one after its last only on the last, so each shows
 * once however the list is paged; a search shows none, since they match
 * nothing.
 */
export function groupByCohort<T extends { month: string }>(
  rows: T[],
  emptyMonths: string[],
  page: { first: boolean; last: boolean; newestFirst: boolean; searching: boolean },
): CohortGroup<T>[] {
  const groups: CohortGroup<T>[] = [];
  for (const row of rows) {
    const last = groups.at(-1);
    if (last?.month === row.month) last.rows.push(row);
    else groups.push({ month: row.month, rows: [row] });
  }
  if (page.searching) return groups;

  // "a comes before b" in the page's order.
  const before = (a: string, b: string) => (page.newestFirst ? a > b : a < b);
  const first = groups[0]?.month;
  const last = groups.at(-1)?.month;
  const shown = new Set(groups.map((g) => g.month));
  const empties = emptyMonths.filter(
    (m) =>
      !shown.has(m) &&
      (first === undefined || last === undefined
        ? page.first
        : (page.first || !before(m, first)) && (page.last || !before(last, m))),
  );
  return [...groups, ...empties.map((month) => ({ month, rows: [] as T[] }))].sort((a, b) =>
    a.month === b.month ? 0 : before(a.month, b.month) ? -1 : 1,
  );
}
