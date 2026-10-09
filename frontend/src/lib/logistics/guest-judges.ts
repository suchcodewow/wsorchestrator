/**
 * Guest judges for the Logistics page: everyone who has judged a cohort,
 * with the sessions they ran on it, whether in the Scheduler or in the
 * guest speaker history kept beside it, and the sales and sales engineering
 * leaders in the employee list from HiBob who have done neither.
 */

import "server-only";

import { and, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { employees, guestSpeakerCohorts, guestSpeakerHistory, type BootcampStatus, type GuestSpeakerRole, type ScheduleTrack } from "@/db/schema";
import type { GuestJudgeSort, JudgeProspectSort } from "@/lib/list-specs";
import {
  GUEST_JUDGE_DEPARTMENTS,
  HIBOB_WORK_LOCATION_COLUMN,
  PROSPECT_GROUPS,
  type GuestSpeakerInput,
  type ProspectGroup,
} from "@/lib/logistics/guest-judge-values";
import { pageWindow, toPage, type ListQuery, type Page } from "@/lib/paging";
import { containsPattern, orderFor, searchAny } from "@/lib/paging-sql";

export type JudgedSession = {
  /** Empty for someone the history has on no particular session. */
  name: string;
  /** "lead" for the Scheduler session they led; the history's role otherwise. */
  role: "lead" | GuestSpeakerRole | null;
  track: ScheduleTrack;
  /** Null for a session from the history, which keeps no day or time. */
  day: number | null;
  start: number | null;
};

export type GuestJudgeRow = {
  id: string;
  /** Null for someone in the history who is not in HiBob. */
  email: string | null;
  fullName: string;
  /** As the employee list has it now; null for someone not in it. */
  title: string | null;
  /** `YYYY-MM-DD`: a Scheduler bootcamp's first day, or the first of a history cohort's month. */
  cohort: string;
  /** The first of `cohort`'s month, `YYYY-MM-DD`: what the page groups by. */
  month: string;
  /** "scheduler" for a bootcamp's guest judges; "history" for an entry kept here, from the sheet or added by hand. */
  source: "scheduler" | "history";
  /** For history: who the entry is kept under, their email or else their lowercased name, to remove it by. */
  person: string | null;
  /** The Scheduler bootcamp and its status; null for history. */
  bootcampId: string | null;
  status: BootcampStatus | null;
  sessions: JudgedSession[];
};

/**
 * One row per person per cohort, from both places guest judges are kept: a
 * Scheduler bootcamp's judges, with the sessions they are on the staff of,
 * and the guest speaker history, its rows for one person and month gathered up.
 */
const judged = sql`(
  select j.id::text as id, j.email, coalesce(nullif(j.full_name, ''), j.email) as full_name,
    b.start_date::text as cohort, date_trunc('month', b.start_date)::date::text as month, 'scheduler' as source, null as person, b.id::text as bootcamp_id, b.status,
    coalesce((
      select json_agg(json_build_object('name', s.name, 'role', case when st.leader then 'lead' end,
          'track', s.track, 'day', s.day, 'start', s.start_minute)
        order by s.day, s.start_minute, s.track)
      from schedule_session_staff st
      join schedule_sessions s on s.id = st.session_id
      where st.email = j.email and s.bootcamp_id = j.bootcamp_id
    ), '[]'::json) as sessions
  from bootcamp_judges j
  join bootcamps b on b.id = j.bootcamp_id
  union all
  select 'history:' || h.cohort || ':' || coalesce(h.email, lower(h.full_name)), h.email, min(h.full_name),
    h.cohort::text, h.cohort::text, 'history', coalesce(h.email, lower(h.full_name)), null, null,
    json_agg(json_build_object('name', h.session, 'role', h.role,
        'track', case h.program when 'bootcamp' then 'btc' else 'int' end, 'day', null, 'start', null)
      order by h.program, h.session, h.role)
  from guest_speaker_history h
  group by h.cohort, coalesce(h.email, lower(h.full_name)), h.email
)`;

const WITHIN_COHORT = {
  name: sql`lower(g.full_name)`,
  sessions: sql`json_array_length(g.sessions)`,
} as const;

/** Each guest judge on each cohort, a page at a time, by month; searched by name, email, title and session. */
export async function listGuestJudges(query: ListQuery<GuestJudgeSort>): Promise<Page<GuestJudgeRow>> {
  const { limit, offset } = pageWindow(query.page);
  const pattern = query.q ? containsPattern(query.q) : null;
  // Always grouped by month, so the page can head each cohort: `cohort` orders
  // the months themselves, and the other sorts order people within each.
  const within =
    query.sort === "cohort"
      ? []
      : [sql`${WITHIN_COHORT[query.sort]} ${sql.raw(query.dir === "asc" ? "asc" : "desc")} nulls last`];
  const order = orderFor(sql`g.month`, query.sort === "cohort" ? query.dir : "desc", ...within, sql`lower(g.full_name)`, sql`g.id`);
  const { rows } = await db.execute<{
    id: string;
    email: string | null;
    full_name: string;
    title: string | null;
    cohort: string;
    month: string;
    source: "scheduler" | "history";
    person: string | null;
    bootcamp_id: string | null;
    status: BootcampStatus | null;
    sessions: JudgedSession[];
  }>(sql`
    select g.*, e.title
    from ${judged} g
    left join employees e on e.email = g.email
    ${pattern ? sql`where g.full_name ilike ${pattern} or g.email ilike ${pattern} or e.title ilike ${pattern} or g.sessions::text ilike ${pattern}` : sql``}
    order by ${sql.join(order, sql`, `)}
    limit ${limit} offset ${offset}
  `);
  return toPage(
    rows.map((r) => ({
      id: r.id,
      email: r.email,
      fullName: r.full_name,
      title: r.title,
      cohort: r.cohort,
      month: r.month,
      source: r.source,
      person: r.person,
      bootcampId: r.bootcamp_id,
      status: r.status,
      sessions: r.sessions,
    })),
    query.page,
  );
}

export type JudgeProspectRow = {
  email: string;
  fullName: string;
  title: string;
  department: string;
  reportsToName: string;
  /** HiBob's work location, "Chicago" or "US-Remote"; null where it has none. */
  location: string | null;
  /** HiBob's site, a country. */
  site: string;
  /** HiBob's start date, `YYYY-MM-DD`: the first day of their current time at Harness. */
  startDate: string | null;
  /** Whole months from `startDate` to today; null where HiBob has no start date. */
  tenureMonths: number | null;
};

/** Whole months since the start date, counted by the database so every viewer sees the same. */
const tenureMonths = sql<number | null>`(extract(year from age(current_date, ${employees.startDate})) * 12 + extract(month from age(current_date, ${employees.startDate})))::int`;

const location = sql<string | null>`nullif(${employees.raw} -> 'humanReadable' -> 'work' -> 'customColumns' ->> ${sql.raw(`'${HIBOB_WORK_LOCATION_COLUMN}'`)}, '')`;

// Written out in full: on a query of `employees` alone Drizzle leaves its columns
// unqualified, and a bare "email" in here would be the report's own.
const reports = sql<number>`(select count(*)::int from employees r where r.reports_to_email = "employees"."email")`;

/** A sales or sales engineering leader in the employee list who has never been on a bootcamp's guest judges. */
const isProspect = and(
  inArray(employees.department, [...GUEST_JUDGE_DEPARTMENTS]),
  sql`${reports} > 0`,
  sql`not exists (select 1 from bootcamp_judges j where j.email = "employees"."email")`,
  sql`not exists (select 1 from guest_speaker_history h where h.email = "employees"."email")`,
);

const PROSPECT_SORTS = {
  name: sql`lower(${employees.fullName})`,
  department: employees.department,
  location: sql`lower(coalesce(${location}, nullif(${employees.site}, '')))`,
  // Ascending is the newest to Harness first, as a count of months would read.
  tenure: tenureMonths,
} as const;

const inGroup = (group: ProspectGroup | null) =>
  group ? inArray(employees.department, [...PROSPECT_GROUPS[group].departments]) : undefined;

/**
 * Those leaders, a page at a time, from the employee list as the last HiBob
 * sync left it; only one of `PROSPECT_GROUPS` when `group` is given.
 */
export async function listJudgeProspects(
  query: ListQuery<JudgeProspectSort>,
  group: ProspectGroup | null = null,
): Promise<Page<JudgeProspectRow>> {
  const { limit, offset } = pageWindow(query.page);
  const rows = await db
    .select({
      email: employees.email,
      fullName: employees.fullName,
      title: employees.title,
      department: employees.department,
      reportsToName: employees.reportsToName,
      location,
      site: employees.site,
      startDate: employees.startDate,
      tenureMonths,
    })
    .from(employees)
    .where(and(isProspect, inGroup(group), searchAny(query.q, [employees.fullName, employees.email, employees.title, location, employees.site])))
    .orderBy(...orderFor(PROSPECT_SORTS[query.sort], query.dir, sql`lower(${employees.fullName})`, employees.email))
    .limit(limit)
    .offset(offset);
  return toPage(rows, query.page);
}

export type GuestJudgeCounts = {
  judges: number;
  cohorts: number;
  prospects: number;
  /** The leaders in each of `PROSPECT_GROUPS`, whatever the search. */
  prospectGroups: Record<ProspectGroup, number>;
};

/** Everyone who has judged, the cohorts they judged, and the leaders yet to; whatever the search. */
export async function guestJudgeCounts(): Promise<GuestJudgeCounts> {
  const [{ rows: [judgedCounts] }, [prospects]] = await Promise.all([
    db.execute<{ judges: number; cohorts: number }>(sql`
      select count(distinct coalesce(g.email, lower(g.full_name)))::int as judges, count(distinct g.cohort)::int as cohorts
      from ${judged} g
    `),
    db
      .select({
        n: sql<number>`count(*)::int`,
        sales: sql<number>`(count(*) filter (where ${inGroup("sales")}))::int`,
        se: sql<number>`(count(*) filter (where ${inGroup("se")}))::int`,
      })
      .from(employees)
      .where(isProspect),
  ]);
  return {
    judges: judgedCounts?.judges ?? 0,
    cohorts: judgedCounts?.cohorts ?? 0,
    prospects: prospects?.n ?? 0,
    prospectGroups: { sales: prospects?.sales ?? 0, se: prospects?.se ?? 0 },
  };
}

/**
 * Adds one guest speaker entry: a person on a session at a month's cohort.
 * An entry already there is left as it is; the result says whether it was new.
 */
export async function addGuestSpeaker(input: GuestSpeakerInput): Promise<{ added: boolean }> {
  const rows = await db
    .insert(guestSpeakerHistory)
    .values({ ...input, cohort: `${input.cohort}-01` })
    .onConflictDoNothing()
    .returning({ id: guestSpeakerHistory.id });
  return { added: rows.length > 0 };
}

/**
 * Removes everything the history holds for one person at one cohort, the
 * `person` and `cohort` a history row gives; the number of entries removed.
 */
export async function removeGuestSpeaker(cohort: string, person: string): Promise<number> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cohort) || !person) return 0;
  const key = person.trim().toLowerCase();
  const rows = await db
    .delete(guestSpeakerHistory)
    .where(
      and(
        eq(guestSpeakerHistory.cohort, cohort),
        or(eq(guestSpeakerHistory.email, key), and(sql`${guestSpeakerHistory.email} is null`, sql`lower(${guestSpeakerHistory.fullName}) = ${key}`)),
      ),
    )
    .returning({ id: guestSpeakerHistory.id });
  return rows.length;
}

/**
 * The months set aside for a cohort with no one in them yet, newest first:
 * no history entries and no Scheduler bootcamp. Few enough to list whole.
 */
export async function listEmptyCohorts(): Promise<string[]> {
  const { rows } = await db.execute<{ cohort: string }>(sql`
    select c.cohort::text as cohort
    from guest_speaker_cohorts c
    where not exists (select 1 from guest_speaker_history h where h.cohort = c.cohort)
      and not exists (select 1 from bootcamps b where date_trunc('month', b.start_date)::date = c.cohort)
    order by c.cohort desc
    limit 100
  `);
  return rows.map((r) => r.cohort);
}

/** Sets a month aside for a cohort; `month` is `YYYY-MM`. Whether it was new. */
export async function addCohort(actorId: string, month: string): Promise<{ added: boolean }> {
  const rows = await db
    .insert(guestSpeakerCohorts)
    .values({ cohort: `${month}-01`, createdBy: actorId })
    .onConflictDoNothing()
    .returning({ cohort: guestSpeakerCohorts.cohort });
  return { added: rows.length > 0 };
}

/**
 * Takes a month off the list of cohorts set aside. One with history entries
 * or a Scheduler bootcamp still shows; this only removes the empty space.
 */
export async function removeCohort(cohort: string): Promise<boolean> {
  if (!/^\d{4}-\d{2}-01$/.test(cohort)) return false;
  const rows = await db
    .delete(guestSpeakerCohorts)
    .where(eq(guestSpeakerCohorts.cohort, cohort))
    .returning({ cohort: guestSpeakerCohorts.cohort });
  return rows.length > 0;
}
