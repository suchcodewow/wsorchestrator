/**
 * The Cohorts page's Current tab: everyone the last HiBob sync gave the Sales
 * or Engineer track, and how many of each. Read from `employees.track`, so it
 * is as fresh as the last sync, like the Organization tab it is drawn from.
 */

import "server-only";

import { and, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { employees, type Employee } from "@/db/schema";
import type { CurrentCohortSort } from "@/lib/list-specs";
import { pageWindow, toPage, type ListQuery, type Page } from "@/lib/paging";
import { blankAsNull, orderFor, searchAny } from "@/lib/paging-sql";

/** The tracks the Current tab lists; `ignored` and `exempt` are the others. */
export const CURRENT_TRACKS = ["sales", "engineer"] as const;
export type CurrentTrack = (typeof CURRENT_TRACKS)[number];

export type CurrentCohortMember = Pick<
  Employee,
  "email" | "fullName" | "title" | "department" | "reportsToEmail" | "reportsToName"
> & { track: CurrentTrack };

export type CurrentCohortSummary = {
  /** Everyone on each track, whatever the search. */
  counts: Record<CurrentTrack, number>;
  /** When the sync that set those tracks ran; null if none has stored anyone. */
  syncedAt: Date | null;
};

const SORT_COLUMNS = {
  fullName: sql`lower(${employees.fullName})`,
  email: employees.email,
  title: sql`lower(${blankAsNull(employees.title)})`,
  department: sql`lower(${blankAsNull(employees.department)})`,
  reportsToName: sql`lower(coalesce(${blankAsNull(employees.reportsToName)}, ${blankAsNull(employees.reportsToEmail)}))`,
  track: employees.track,
} as const;

const onCurrentTrack = inArray(employees.track, [...CURRENT_TRACKS]);

/** One page of the Current tab. The search matches the name, email, title, department, manager or track. */
export async function listCurrentCohort(query: ListQuery<CurrentCohortSort>): Promise<Page<CurrentCohortMember>> {
  const { limit, offset } = pageWindow(query.page);
  const e = employees;
  const rows = await db
    .select({
      email: e.email,
      fullName: e.fullName,
      title: e.title,
      department: e.department,
      reportsToEmail: e.reportsToEmail,
      reportsToName: e.reportsToName,
      track: sql<CurrentTrack>`${e.track}`,
    })
    .from(e)
    .where(
      and(
        onCurrentTrack,
        searchAny(query.q, [e.fullName, e.email, e.title, e.department, e.reportsToName, e.reportsToEmail, e.track]),
      ),
    )
    .orderBy(...orderFor(SORT_COLUMNS[query.sort], query.dir, sql`lower(${e.fullName})`, e.id))
    .limit(limit)
    .offset(offset);
  return toPage(rows, query.page);
}

/** How many are on each track, and as of which sync. */
export async function currentCohortSummary(): Promise<CurrentCohortSummary> {
  const [row] = await db
    .select({
      sales: sql<number>`count(*) filter (where ${employees.track} = 'sales')::int`,
      engineer: sql<number>`count(*) filter (where ${employees.track} = 'engineer')::int`,
      // A sync stamps every row with the same time.
      syncedAt: sql<string | null>`max(${employees.importedAt})`,
    })
    .from(employees);
  return {
    counts: { sales: row?.sales ?? 0, engineer: row?.engineer ?? 0 },
    syncedAt: row?.syncedAt ? new Date(row.syncedAt) : null,
  };
}
