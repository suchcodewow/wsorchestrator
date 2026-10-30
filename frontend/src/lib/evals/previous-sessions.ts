/**
 * Cohorts → Previous: each day a bootcamp's BTC or INT class was released,
 * with who attended, read from their assessments as everything else is (see
 * `attendance.ts`). Each attendee opens their page on Reporting → Live
 * Sessions.
 */

import "server-only";

import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { bootcamps, employees, evalsAssessments, evalsSubmissions } from "@/db/schema";
import type { PreviousSessionSort } from "@/lib/list-specs";
import { pageWindow, toPage, type ListQuery, type Page } from "@/lib/paging";
import { orderFor } from "@/lib/paging-sql";
import { keyOf, nameOf } from "@/lib/reporting/bootcamp";

export type SessionStage = "bootcamp" | "intermediate";

/** One attendance: someone assessed in a released class, once however many assessments they had there. */
const ATTENDANCE = sql`(
  select distinct s.attendee_email as email, a.stage, b.start_date as day
    from ${evalsSubmissions} s
    join ${evalsAssessments} a on a.id = s.assessment_id
    join ${bootcamps} b on b.id = s.bootcamp_id
   where (a.stage = 'bootcamp' and b.btc_released_at is not null)
      or (a.stage = 'intermediate' and b.int_released_at is not null)
)`;

/** A day BTC or INT was held, and how many attended each. */
export type PreviousSession = { date: string; bootcamp: number; intermediate: number };

const SESSION_SORT_COLUMNS: Record<PreviousSessionSort, SQL> = {
  date: sql`day`,
  bootcamp: sql`bootcamp`,
  intermediate: sql`intermediate`,
};

/** One page of the days BTC or INT was held, newest first by default, with each one's head count. */
export async function listPreviousSessions(query: ListQuery<PreviousSessionSort>): Promise<Page<PreviousSession>> {
  const { limit, offset } = pageWindow(query.page);
  const order = orderFor(SESSION_SORT_COLUMNS[query.sort], query.dir, sql`day desc`);
  const { rows } = await db.execute<PreviousSession>(sql`
    select day::text as date,
           (count(*) filter (where stage = 'bootcamp'))::int as bootcamp,
           (count(*) filter (where stage = 'intermediate'))::int as intermediate
      from ${ATTENDANCE} d
     group by day
     order by ${sql.join(order, sql`, `)}
     limit ${limit} offset ${offset}`);
  return toPage(rows, query.page);
}

/** How many sessions there have been, and the first one's day, whatever page is shown. */
export async function previousSessionsSummary(): Promise<{ sessions: number; first: string | null }> {
  const { rows } = await db.execute<{ sessions: number; first: string | null }>(sql`
    select count(distinct day)::int as sessions, min(day)::text as first from ${ATTENDANCE} d`);
  return rows[0] ?? { sessions: 0, first: null };
}

/** `key` addresses their page on Reporting → Live Sessions. */
export type SessionAttendee = { key: string; email: string; fullName: string | null; active: boolean };

/** One page of who attended `stage` on `date`, by name, with whoever has left after them. */
async function listSessionAttendees(stage: SessionStage, date: string, page: number): Promise<Page<SessionAttendee>> {
  const { limit, offset } = pageWindow(page);
  const { rows } = await db.execute<SessionAttendee>(sql`
    select p.key, p.email, p.full_name as "fullName", p.active
      from (
        select d.email,
               ${keyOf(sql`d.email`)} as key,
               ${nameOf(sql`d.email`)} as full_name,
               coalesce((select bool_or(n.active) from ${employees} n where n.email = d.email), false) as active
          from ${ATTENDANCE} d
         where d.stage = ${stage} and d.day = ${date}
      ) p
     order by lower(p.full_name) asc nulls last, p.email
     limit ${limit} offset ${offset}`);
  return toPage(rows, page);
}

export type SessionDetail = { date: string } & Record<SessionStage, Page<SessionAttendee>>;

/** Who attended BTC on `date` and who attended INT on it, each side a page at a time; null when no one attended either. */
export async function getSessionDetail(date: string, pages: Record<SessionStage, number>): Promise<SessionDetail | null> {
  const [bootcamp, intermediate, { rows: held }] = await Promise.all([
    listSessionAttendees("bootcamp", date, pages.bootcamp),
    listSessionAttendees("intermediate", date, pages.intermediate),
    db.execute(sql`select 1 from ${ATTENDANCE} d where d.day = ${date} limit 1`),
  ]);
  if (held.length === 0) return null;
  return { date, bootcamp, intermediate };
}
