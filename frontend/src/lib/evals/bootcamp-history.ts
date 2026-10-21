/**
 * Bootcamp history: who attended BTC and INT, and how they scored.
 *
 * It is kept on each person's `employees` row (`btcDate` … `historyUpdatedAt`),
 * which replaced the Bootcamp_History sheet and the table it was imported
 * into. A bootcamp writes its scores there when a class is released, and an
 * Assessments Administrator can correct them from Reporting → Bootcamp.
 * Someone with a history whom HiBob has never sent has an inactive row of
 * their own (`ensureEmployees`), so nobody's history is lost.
 */

import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq, inArray, or, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { BOOTCAMP_SCORE, EXEMPT_DATE, employees, hasHistory, users, type Employee } from "@/db/schema";
import { nameFromEmail } from "@/lib/evals/hibob-record";
import { isIsoDay, roundScore } from "@/lib/evals/history-values";
import { retrackEmployees } from "@/lib/evals/tracks";
import type { BootcampHistorySort, HistoryStatus, PreviousSessionSort } from "@/lib/list-specs";
import { pageWindow, toPage, type ListQuery, type Page } from "@/lib/paging";
import { orderFor, searchAny } from "@/lib/paging-sql";

/** Their name, or null where neither HiBob nor their email gave one. */
const historyName = sql<string | null>`nullif(${employees.fullName}, '')`;

const STATUS_FILTER: Record<HistoryStatus, SQL> = {
  active: sql`${employees.active}`,
  inactive: sql`not ${employees.active}`,
};

const HISTORY_SORT_COLUMNS = {
  btcDate: employees.btcDate,
  fullName: sql`lower(${historyName})`,
  email: employees.email,
} as const;

export type HistoryListing = { id: string; email: string; fullName: string | null; btcDate: string | null };

/**
 * One page of history, a name, email and bootcamp date each; the search
 * matches the name or email, and `status` keeps only the active or inactive.
 */
export async function listHistoryPage(
  query: ListQuery<BootcampHistorySort>,
  status: HistoryStatus | null = null,
): Promise<Page<HistoryListing>> {
  const { limit, offset } = pageWindow(query.page);
  const rows = await db
    .select({
      id: employees.id,
      email: employees.email,
      fullName: historyName,
      btcDate: employees.btcDate,
    })
    .from(employees)
    .where(and(hasHistory, searchAny(query.q, [historyName, employees.email]), status ? STATUS_FILTER[status] : undefined))
    // A bootcamp's class shares one date, so they fall back to name order.
    .orderBy(...orderFor(HISTORY_SORT_COLUMNS[query.sort], query.dir, sql`${HISTORY_SORT_COLUMNS.fullName} asc nulls last`, employees.email))
    .limit(limit)
    .offset(offset);
  return toPage(rows, query.page);
}

export type HistoryCounts = { total: number } & Record<HistoryStatus, number>;

/** How many people have a history, and how many of them are still at Harness, whatever the search. */
export async function historyCounts(): Promise<HistoryCounts> {
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      active: sql<number>`(count(*) filter (where ${employees.active}))::int`,
    })
    .from(employees)
    .where(hasHistory);
  const total = row?.total ?? 0;
  const active = row?.active ?? 0;
  return { total, active, inactive: total - active };
}

/** A day someone attended BTC or INT on, and how many attended each; the exempt marker is no session. */
export type PreviousSession = { date: string; bootcamp: number; intermediate: number };

const SESSION_DAYS = sql`(
  select btc_date as day, 1 as at_btc, 0 as at_int from ${employees} where btc_date is not null and btc_date <> ${EXEMPT_DATE}
  union all
  select int_date, 0, 1 from ${employees} where int_date is not null and int_date <> ${EXEMPT_DATE}
)`;

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
    select day::text as date, sum(at_btc)::int as bootcamp, sum(at_int)::int as intermediate
      from ${SESSION_DAYS} d
     group by day
     order by ${sql.join(order, sql`, `)}
     limit ${limit} offset ${offset}`);
  return toPage(rows, query.page);
}

/** How many sessions there have been, and the first one's day, whatever page is shown. */
export async function previousSessionsSummary(): Promise<{ sessions: number; first: string | null }> {
  const { rows } = await db.execute<{ sessions: number; first: string | null }>(sql`
    select count(distinct day)::int as sessions, min(day)::text as first from ${SESSION_DAYS} d`);
  return rows[0] ?? { sessions: 0, first: null };
}

export type SessionStage = "bootcamp" | "intermediate";

export type SessionAttendee = { id: string; email: string; fullName: string | null; active: boolean };

const STAGE_DATE = {
  bootcamp: employees.btcDate,
  intermediate: employees.intDate,
} satisfies Record<SessionStage, AnyColumn>;

/** One page of who attended `stage` on `date`, by name, with whoever has left after them. */
async function listSessionAttendees(stage: SessionStage, date: string, page: number): Promise<Page<SessionAttendee>> {
  const { limit, offset } = pageWindow(page);
  const rows = await db
    .select({ id: employees.id, email: employees.email, fullName: historyName, active: employees.active })
    .from(employees)
    .where(eq(STAGE_DATE[stage], date))
    .orderBy(sql`${HISTORY_SORT_COLUMNS.fullName} asc nulls last`, employees.email)
    .limit(limit)
    .offset(offset);
  return toPage(rows, page);
}

export type SessionDetail = { date: string } & Record<SessionStage, Page<SessionAttendee>>;

/**
 * Who attended BTC on `date` and who attended INT on it, each side a page at
 * a time; null when no one attended either, which includes the exempt marker.
 */
export async function getSessionDetail(date: string, pages: Record<SessionStage, number>): Promise<SessionDetail | null> {
  if (date === EXEMPT_DATE) return null;
  const [bootcamp, intermediate, [held]] = await Promise.all([
    listSessionAttendees("bootcamp", date, pages.bootcamp),
    listSessionAttendees("intermediate", date, pages.intermediate),
    db
      .select({ id: employees.id })
      .from(employees)
      .where(or(eq(employees.btcDate, date), eq(employees.intDate, date)))
      .limit(1),
  ]);
  if (!held) return null;
  return { date, bootcamp, intermediate };
}

export type HistoryDetail = Pick<
  Employee,
  "id" | "email" | "btcDate" | "intDate" | "btcScore" | "intScore" | "btcIndividualScores" | "intIndividualScores"
> & {
  /** Their name, or null where neither HiBob nor their email gave one. */
  fullName: string | null;
  /** When their history was first and last written; null only for a history from before these were kept. */
  createdAt: Date | null;
  updatedAt: Date | null;
  /** Who last changed it, by name or else email; null for the imported sheet, or a deleted account. */
  updatedByName: string | null;
  /** Who they are in HiBob now, or null for someone HiBob no longer sends, or never did. */
  employee: Pick<Employee, "fullName" | "title" | "department" | "site" | "reportsToName" | "reportsToEmail" | "startDate" | "track"> | null;
};

/** One person's whole history, by their employee id, with who they are in HiBob. */
export async function getHistoryDetail(id: string): Promise<HistoryDetail | null> {
  const [row] = await db
    .select({
      person: employees,
      updatedByName: sql<string | null>`coalesce(nullif(${users.name}, ''), ${users.email})`,
    })
    .from(employees)
    .leftJoin(users, eq(users.id, employees.historyUpdatedBy))
    .where(and(eq(employees.id, id), hasHistory));
  if (!row) return null;
  const e = row.person;
  return {
    id: e.id,
    email: e.email,
    fullName: e.fullName || null,
    btcDate: e.btcDate,
    intDate: e.intDate,
    btcScore: e.btcScore,
    intScore: e.intScore,
    btcIndividualScores: e.btcIndividualScores,
    intIndividualScores: e.intIndividualScores,
    createdAt: e.historyCreatedAt,
    updatedAt: e.historyUpdatedAt,
    updatedByName: row.updatedByName,
    employee: e.active
      ? {
          fullName: e.fullName,
          title: e.title,
          department: e.department,
          site: e.site,
          reportsToName: e.reportsToName,
          reportsToEmail: e.reportsToEmail,
          startDate: e.startDate,
          track: e.track,
        }
      : null,
  };
}

export type HistoryError = "invalid" | "not_found";

export const STATUS_FOR: Record<HistoryError, number> = {
  invalid: 400,
  not_found: 404,
};

const day = z.string().refine(isIsoDay).nullable();

const score = z.number().min(BOOTCAMP_SCORE.min).max(BOOTCAMP_SCORE.max).transform(roundScore);

/** A class's score per exercise, by the exercise's name as the Sheet had it. */
const individualScores = z
  .record(z.string().trim().min(1).max(200), score)
  .refine((scores) => Object.keys(scores).length <= 50, "too many exercises")
  .nullable();

/**
 * Reporting → Bootcamp's correction to someone's history: its days and each
 * exercise's score, but never whose it is, nor a class's overall score,
 * which is always the mean of its exercise scores.
 */
export const historyCorrectionSchema = z
  .object({ btcDate: day, intDate: day, btcIndividualScores: individualScores, intIndividualScores: individualScores })
  .partial();

export type HistoryCorrection = z.infer<typeof historyCorrectionSchema>;

/** A correction, with the overall scores it works out. */
type HistoryPatch = HistoryCorrection & { btcScore?: number | null; intScore?: number | null };

/** Changes the fields `patch` names on the history of the employee `id`. */
export async function updateHistory(
  actorId: string,
  id: string,
  patch: HistoryPatch,
): Promise<{ ok: true; email: string } | { ok: false; error: HistoryError }> {
  const now = new Date();
  const [updated] = await db
    .update(employees)
    .set({
      ...patch,
      historyUpdatedBy: actorId,
      historyUpdatedAt: now,
      historyCreatedAt: sql`coalesce(${employees.historyCreatedAt}, ${now})`,
    })
    .where(and(eq(employees.id, id), hasHistory))
    .returning({ email: employees.email });
  if (!updated) return { ok: false, error: "not_found" };
  await retrackEmployees([updated.email]);
  return { ok: true, email: updated.email };
}

type Runner = Pick<typeof db, "select" | "insert">;

/**
 * Gives each of `emails` (lowercased) with no `employees` row an inactive one
 * of their own, named from the email as the HiBob sync would, so a history
 * can be written for someone HiBob has never sent — a guest at a bootcamp,
 * say. Should HiBob send them later, the sync carries the history onto the
 * row it makes.
 */
export async function ensureEmployees(runner: Runner, emails: string[]): Promise<void> {
  const wanted = [...new Set(emails)];
  if (wanted.length === 0) return;
  const have = new Set(
    (await runner.select({ email: employees.email }).from(employees).where(inArray(employees.email, wanted))).map((r) => r.email),
  );
  const missing = wanted.filter((e) => !have.has(e));
  if (missing.length === 0) return;
  await runner
    .insert(employees)
    .values(missing.map((email) => ({ id: randomUUID(), email, fullName: nameFromEmail(email, ""), raw: {}, active: false })))
    .onConflictDoNothing();
}
