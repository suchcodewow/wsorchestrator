/**
 * Bootcamp history: who attended BTC and INT, and how they scored.
 *
 * This table is the record — it replaces the Bootcamp_History sheet, which
 * was imported once to start it. A bootcamp writes its scores here at the end
 * of a session, and the app only ever shows them after that: nobody edits
 * history in the UI. An upload, when one is used, writes only the columns its
 * file has.
 */

import "server-only";

import { and, asc, eq, or, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  BOOTCAMP_HISTORY_LIMITS,
  BOOTCAMP_SCORE,
  EXEMPT_DATE,
  bootcampHistory,
  employees,
  users,
  type BootcampHistory,
  type Employee,
} from "@/db/schema";
import { parseHistorySheet, type HistoryField, type HistoryProblem } from "@/lib/evals/bootcamp-history-file";
import { isIsoDay, normalEmail, roundScore } from "@/lib/evals/history-values";
import { retrackEmployees } from "@/lib/evals/tracks";
import type { BootcampHistorySort, HistoryStatus, PreviousSessionSort } from "@/lib/list-specs";
import { pageWindow, toPage, type ListQuery, type Page } from "@/lib/paging";
import { orderFor, searchAny } from "@/lib/paging-sql";
import { readSpreadsheet } from "@/lib/spreadsheet-file";

export async function listHistory(): Promise<BootcampHistory[]> {
  return db.select().from(bootcampHistory).orderBy(asc(bootcampHistory.email));
}

/**
 * The person's name as the employee list has it. History outlives the sync,
 * so someone who has left has none. Both emails are stored lowercased.
 */
// Spelled out, because Drizzle leaves the table off a column in a one-table
// query, and an unqualified `email` here would mean the employee's own.
const historyName = sql<string | null>`(select n.full_name from ${employees} n where n.email = ${bootcampHistory}.email order by n.full_name limit 1)`;

/** Still at Harness: the last HiBob sync stored someone with this email. */
const isActive = sql<boolean>`exists (select 1 from ${employees} a where a.email = ${bootcampHistory}.email)`;

const STATUS_FILTER: Record<HistoryStatus, SQL> = {
  active: isActive,
  inactive: sql`not ${isActive}`,
};

const HISTORY_SORT_COLUMNS = {
  btcDate: bootcampHistory.btcDate,
  fullName: sql`lower(${historyName})`,
  email: bootcampHistory.email,
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
      id: bootcampHistory.id,
      email: bootcampHistory.email,
      fullName: historyName,
      btcDate: bootcampHistory.btcDate,
    })
    .from(bootcampHistory)
    .where(and(searchAny(query.q, [historyName, bootcampHistory.email]), status ? STATUS_FILTER[status] : undefined))
    // A bootcamp's class shares one date, so they fall back to name order.
    .orderBy(...orderFor(HISTORY_SORT_COLUMNS[query.sort], query.dir, sql`${HISTORY_SORT_COLUMNS.fullName} asc nulls last`, bootcampHistory.email))
    .limit(limit)
    .offset(offset);
  return toPage(rows, query.page);
}

export type HistoryCounts = { total: number } & Record<HistoryStatus, number>;

/** How many people have a history row, and how many of them are still at Harness, whatever the search. */
export async function historyCounts(): Promise<HistoryCounts> {
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      active: sql<number>`(count(*) filter (where ${isActive}))::int`,
    })
    .from(bootcampHistory);
  const total = row?.total ?? 0;
  const active = row?.active ?? 0;
  return { total, active, inactive: total - active };
}

/** A day someone attended BTC or INT on, and how many attended each; the exempt marker is no session. */
export type PreviousSession = { date: string; bootcamp: number; intermediate: number };

const SESSION_DAYS = sql`(
  select btc_date as day, 1 as at_btc, 0 as at_int from ${bootcampHistory} where btc_date is not null and btc_date <> ${EXEMPT_DATE}
  union all
  select int_date, 0, 1 from ${bootcampHistory} where int_date is not null and int_date <> ${EXEMPT_DATE}
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
  bootcamp: bootcampHistory.btcDate,
  intermediate: bootcampHistory.intDate,
} satisfies Record<SessionStage, AnyColumn>;

/** One page of who attended `stage` on `date`, by name, with whoever has left after them. */
async function listSessionAttendees(stage: SessionStage, date: string, page: number): Promise<Page<SessionAttendee>> {
  const { limit, offset } = pageWindow(page);
  const rows = await db
    .select({ id: bootcampHistory.id, email: bootcampHistory.email, fullName: historyName, active: isActive })
    .from(bootcampHistory)
    .where(eq(STAGE_DATE[stage], date))
    .orderBy(sql`${HISTORY_SORT_COLUMNS.fullName} asc nulls last`, bootcampHistory.email)
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
      .select({ id: bootcampHistory.id })
      .from(bootcampHistory)
      .where(or(eq(bootcampHistory.btcDate, date), eq(bootcampHistory.intDate, date)))
      .limit(1),
  ]);
  if (!held) return null;
  return { date, bootcamp, intermediate };
}

export type HistoryDetail = BootcampHistory & {
  /** Who last changed the row, by name or else email; null for an import with no account, or a deleted one. */
  updatedByName: string | null;
  /** The employee list's record for the email, or null for someone not in it. */
  employee: Pick<Employee, "fullName" | "title" | "department" | "site" | "reportsToName" | "reportsToEmail" | "startDate" | "track"> | null;
};

/** One person's whole row, with who they are from the employee list. */
export async function getHistoryDetail(id: string): Promise<HistoryDetail | null> {
  const [row] = await db
    .select({
      history: bootcampHistory,
      updatedByName: sql<string | null>`coalesce(nullif(${users.name}, ''), ${users.email})`,
    })
    .from(bootcampHistory)
    .leftJoin(users, eq(users.id, bootcampHistory.updatedBy))
    .where(eq(bootcampHistory.id, id));
  if (!row) return null;

  const [employee] = await db
    .select({
      fullName: employees.fullName,
      title: employees.title,
      department: employees.department,
      site: employees.site,
      reportsToName: employees.reportsToName,
      reportsToEmail: employees.reportsToEmail,
      startDate: employees.startDate,
      track: employees.track,
    })
    .from(employees)
    .where(eq(employees.email, row.history.email))
    .orderBy(asc(employees.fullName))
    .limit(1);

  return { ...row.history, updatedByName: row.updatedByName, employee: employee ?? null };
}

export type ImportError = "no_file" | "too_large" | "unreadable" | "empty" | "no_email_column" | "too_many_rows";

export type HistoryError = "invalid" | "duplicate" | "not_found";

export const STATUS_FOR: Record<ImportError | HistoryError, number> = {
  no_file: 400,
  too_large: 413,
  unreadable: 400,
  empty: 400,
  no_email_column: 400,
  too_many_rows: 413,
  invalid: 400,
  duplicate: 409,
  not_found: 404,
};

const email = z
  .string()
  .max(BOOTCAMP_HISTORY_LIMITS.email)
  .transform((v, ctx) => {
    const normal = normalEmail(v);
    if (normal) return normal;
    ctx.addIssue({ code: "custom", message: "not an email address" });
    return z.NEVER;
  });

const day = z.string().refine(isIsoDay).nullable();

const score = z.number().min(BOOTCAMP_SCORE.min).max(BOOTCAMP_SCORE.max).transform(roundScore).nullable();

/** One person's row as a form sets it. Individual scores come from grading, not the form. */
export const historyInputSchema = z.object({
  email,
  btcDate: day,
  intDate: day,
  btcScore: score,
  intScore: score,
});

/** An edit changes only the fields it names. */
export const historyPatchSchema = historyInputSchema.partial();

type HistoryInput = z.infer<typeof historyInputSchema>;
type HistoryPatch = z.infer<typeof historyPatchSchema>;

const isUniqueViolation = (err: unknown): boolean => {
  const code = (e: unknown) => (e as { code?: unknown } | null)?.code;
  return code(err) === "23505" || code((err as { cause?: unknown } | null)?.cause) === "23505";
};

export async function createHistory(
  actorId: string,
  input: HistoryInput,
): Promise<{ ok: true; id: string } | { ok: false; error: HistoryError }> {
  const [row] = await db
    .insert(bootcampHistory)
    .values({ ...input, updatedBy: actorId })
    .onConflictDoNothing()
    .returning({ id: bootcampHistory.id });
  if (!row) return { ok: false, error: "duplicate" };
  await retrackEmployees([input.email]);
  return { ok: true, id: row.id };
}

export async function updateHistory(
  actorId: string,
  id: string,
  patch: HistoryPatch,
): Promise<{ ok: true } | { ok: false; error: HistoryError }> {
  const [before] = await db
    .select({ email: bootcampHistory.email })
    .from(bootcampHistory)
    .where(eq(bootcampHistory.id, id));
  if (!before) return { ok: false, error: "not_found" };
  try {
    const updated = await db
      .update(bootcampHistory)
      .set({ ...patch, updatedBy: actorId, updatedAt: new Date() })
      .where(eq(bootcampHistory.id, id))
      .returning({ email: bootcampHistory.email });
    if (updated.length === 0) return { ok: false, error: "not_found" };
    // A new email moves the track with it.
    await retrackEmployees([before.email, ...updated.map((u) => u.email)]);
    return { ok: true };
  } catch (err) {
    // A new email that someone else already has.
    if (isUniqueViolation(err)) return { ok: false, error: "duplicate" };
    throw err;
  }
}

export async function deleteHistory(id: string): Promise<boolean> {
  const deleted = await db
    .delete(bootcampHistory)
    .where(eq(bootcampHistory.id, id))
    .returning({ email: bootcampHistory.email });
  await retrackEmployees(deleted.map((d) => d.email));
  return deleted.length > 0;
}

export type ImportSummary = {
  added: number;
  updated: number;
  problems: HistoryProblem[];
  ignoredColumns: string[];
};

const BATCH = 500;

const EXCLUDED: Record<HistoryField, SQL> = {
  btcDate: sql`excluded.btc_date`,
  intDate: sql`excluded.int_date`,
  btcScore: sql`excluded.btc_score`,
  intScore: sql`excluded.int_score`,
  btcIndividualScores: sql`excluded.btc_individual_scores`,
  intIndividualScores: sql`excluded.int_individual_scores`,
};

/**
 * Reads an uploaded sheet and stores its rows by email. Only the columns the
 * sheet has are written, so an INT-only sheet leaves BTC results alone; a
 * blank cell in one of them clears it. Emails not in the file are untouched.
 */
export async function importHistory(
  actorId: string,
  file: File | null,
): Promise<{ ok: true; summary: ImportSummary } | { ok: false; error: ImportError }> {
  if (!file || file.size === 0) return { ok: false, error: "no_file" };
  if (file.size > BOOTCAMP_HISTORY_LIMITS.bytes) return { ok: false, error: "too_large" };

  let parsed;
  try {
    parsed = parseHistorySheet(readSpreadsheet(Buffer.from(await file.arrayBuffer())));
  } catch {
    return { ok: false, error: "unreadable" };
  }
  if (!parsed.ok) return parsed;
  if (parsed.rows.length > BOOTCAMP_HISTORY_LIMITS.rows) return { ok: false, error: "too_many_rows" };

  const set = {
    ...Object.fromEntries(parsed.columns.map((c) => [c, EXCLUDED[c]])),
    updatedBy: sql`excluded.updated_by`,
    updatedAt: sql`excluded.updated_at`,
  };

  let added = 0;
  const now = new Date();
  await db.transaction(async (tx) => {
    for (let i = 0; i < parsed.rows.length; i += BATCH) {
      const batch = parsed.rows.slice(i, i + BATCH).map((r) => ({ ...r, updatedBy: actorId, updatedAt: now }));
      const written = await tx
        .insert(bootcampHistory)
        .values(batch)
        .onConflictDoUpdate({ target: bootcampHistory.email, set })
        // A row Postgres inserted, rather than updated, has no xmax yet.
        .returning({ inserted: sql<boolean>`(xmax = 0)` });
      added += written.filter((w) => w.inserted).length;
    }
  });
  await retrackEmployees(parsed.rows.map((r) => r.email));

  return {
    ok: true,
    summary: {
      added,
      updated: parsed.rows.length - added,
      problems: parsed.problems,
      ignoredColumns: parsed.ignoredColumns,
    },
  };
}
