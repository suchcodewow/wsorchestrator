/**
 * The HiBob sync: every active employee into `employees`, and a log of each run.
 *
 * The service user comes from the deployment — `hibob_userid` and `hibob_token`
 * in terraform.tfvars, which reach the app as `HIBOB_SERVICE_USER_ID` and
 * `HIBOB_TOKEN` — not from anything entered in the app. A sync runs every day
 * at 3 AM Eastern (Cloud Scheduler, see infra/admin/scheduler.tf) and whenever
 * an eVals administrator asks. Like the Apps Script it replaces
 * (`fetchHibobToEmployees`), it asks HiBob for every active employee and
 * rewrites the whole table — here in one transaction, so a failed sync leaves
 * the previous one in place.
 */

import "server-only";

import { and, desc, eq, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  employees,
  hibobSyncRuns,
  users,
  type HibobSyncStatus,
  type HibobSyncTrigger,
} from "@/db/schema";
import { hibobAuthorization, toEmployeeRow } from "@/lib/evals/hibob-record";
import { orgUnder } from "@/lib/evals/org";
import { getOrgLeaderEmail } from "@/lib/evals/settings";
import type { HibobSyncSort } from "@/lib/list-specs";
import { pageWindow, toPage, type ListQuery, type Page } from "@/lib/paging";
import { orderFor, searchAny } from "@/lib/paging-sql";

const SEARCH_URL = "https://api.hibob.com/v1/people/search";

/**
 * How long a run may say `running` before it is taken to have been cut off —
 * an instance recycled mid-sync never writes its end. Well past the route's
 * 180s limit.
 */
const STALE_MS = 10 * 60_000;

export type HibobError =
  | "not_configured"
  | "already_running"
  | "rejected"
  | "unreachable"
  | "bad_response";

export const STATUS_FOR: Record<HibobError, number> = {
  not_configured: 409,
  already_running: 409,
  rejected: 422,
  unreachable: 502,
  bad_response: 502,
};

/** What a failed run records, before any detail HiBob gave. */
const LOGGED: Record<HibobError, string> = {
  not_configured: "HiBob credentials are not configured — set hibob_userid and hibob_token in terraform.tfvars.",
  already_running: "Another sync was already running.",
  rejected: "HiBob turned the service user's credentials down.",
  unreachable: "Could not reach HiBob.",
  bad_response: "HiBob answered with something unexpected.",
};

type Credentials = { serviceUserId: string; token: string };

function credentials(): Credentials | null {
  const serviceUserId = process.env.HIBOB_SERVICE_USER_ID?.trim();
  const token = process.env.HIBOB_TOKEN?.trim();
  return serviceUserId && token ? { serviceUserId, token } : null;
}

/** The service user the deployment syncs with; the token is never shown. */
export function hibobServiceUser(): string | null {
  return credentials()?.serviceUserId ?? null;
}

/** One `people/search` call; the employees, or why there are none. */
async function search(
  creds: Credentials,
): Promise<{ ok: true; employees: unknown[] } | { ok: false; error: HibobError; detail?: string }> {
  let res: Response;
  try {
    res = await fetch(SEARCH_URL, {
      method: "POST",
      headers: {
        Authorization: hibobAuthorization(creds.serviceUserId, creds.token),
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ showInactive: false, humanReadable: "APPEND" }),
      signal: AbortSignal.timeout(120_000),
      cache: "no-store",
    });
  } catch (err) {
    // undici's own message is just "fetch failed"; the reason is its cause.
    const cause = err instanceof Error && err.cause instanceof Error ? err.cause.message : null;
    return {
      ok: false,
      error: "unreachable",
      detail: cause ?? (err instanceof Error ? err.message : undefined),
    };
  }

  if (res.status === 401 || res.status === 403) {
    return { ok: false, error: "rejected", detail: `HiBob answered ${res.status}` };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, error: "bad_response", detail: `HiBob answered ${res.status} ${text.slice(0, 200)}` };
  }

  const json = (await res.json().catch(() => null)) as { employees?: unknown } | null;
  if (!json || !Array.isArray(json.employees)) {
    return { ok: false, error: "bad_response", detail: "HiBob's answer had no employee list" };
  }
  return { ok: true, employees: json.employees };
}

/** Marks runs that have said `running` for too long as cut off. */
async function closeStaleRuns(): Promise<void> {
  await db
    .update(hibobSyncRuns)
    .set({ status: "failed", error: "Did not finish — the server stopped mid-sync." })
    .where(
      and(
        eq(hibobSyncRuns.status, "running"),
        lt(hibobSyncRuns.startedAt, new Date(Date.now() - STALE_MS)),
      ),
    );
}

/** Opens a run, or null if one is already running — the partial unique index allows one. */
async function startRun(trigger: HibobSyncTrigger, actorId: string | null): Promise<string | null> {
  await closeStaleRuns();
  const [run] = await db
    .insert(hibobSyncRuns)
    .values({ trigger, triggeredBy: actorId })
    .onConflictDoNothing()
    .returning({ id: hibobSyncRuns.id });
  return run?.id ?? null;
}

async function failRun(runId: string, error: HibobError, detail?: string): Promise<void> {
  await db
    .update(hibobSyncRuns)
    .set({
      status: "failed",
      finishedAt: new Date(),
      error: detail && error !== "not_configured" ? `${LOGGED[error]} ${detail}` : LOGGED[error],
    })
    .where(eq(hibobSyncRuns.id, runId));
}

const BATCH = 500;

export type SyncResult =
  | { ok: true; runId: string; count: number; skipped: number }
  | { ok: false; runId: string | null; error: HibobError; detail?: string };

/**
 * Replaces every stored employee with HiBob's current list, logging the run.
 * `actorId` is whoever pressed the button, or null for the schedule.
 */
export async function syncHibobEmployees(
  trigger: HibobSyncTrigger,
  actorId: string | null,
): Promise<SyncResult> {
  const runId = await startRun(trigger, actorId);
  if (!runId) return { ok: false, runId: null, error: "already_running" };

  try {
    const creds = credentials();
    if (!creds) {
      await failRun(runId, "not_configured");
      return { ok: false, runId, error: "not_configured" };
    }

    const result = await search(creds);
    if (!result.ok) {
      await failRun(runId, result.error, result.detail);
      return { ...result, runId };
    }

    const rows = result.employees.map(toEmployeeRow).filter((r) => r !== null);
    // HiBob ids are unique, but a repeat would abort the whole insert.
    const unique = [...new Map(rows.map((r) => [r.id, r])).values()];
    const skipped = result.employees.length - unique.length;
    const importedAt = new Date();

    // Who the Automation tab's Organization Leader field names right now —
    // whoever that was when this sync started, not when an admin next changes it.
    const leaderEmail = (await getOrgLeaderEmail()).toLowerCase();
    const orgDepth = new Map(orgUnder(unique, leaderEmail).map((p) => [p.id, p.chain.length]));

    await db.transaction(async (tx) => {
      // Two syncs are kept apart by the one-running index, but a revision from
      // before it (importing through the hibob_employees view) is not.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('hibob_employees'))`);
      await tx.delete(employees);
      for (let i = 0; i < unique.length; i += BATCH) {
        await tx
          .insert(employees)
          .values(unique.slice(i, i + BATCH).map((r) => ({ ...r, importedAt, orgDepth: orgDepth.get(r.id) ?? null })));
      }
      await tx
        .update(hibobSyncRuns)
        .set({
          status: "succeeded",
          finishedAt: new Date(),
          employeeCount: unique.length,
          skipped,
          orgLeaderEmail: leaderEmail || null,
        })
        .where(eq(hibobSyncRuns.id, runId));
    });

    return { ok: true, runId, count: unique.length, skipped };
  } catch (err) {
    // Anything else — the database, most likely — still ends the run, so the
    // log never shows a sync as running that is not.
    await db
      .update(hibobSyncRuns)
      .set({
        status: "failed",
        finishedAt: new Date(),
        error: err instanceof Error ? err.message.slice(0, 500) : "The sync failed.",
      })
      .where(eq(hibobSyncRuns.id, runId))
      .catch(() => {});
    throw err;
  }
}

export type HibobSyncRunSummary = {
  id: string;
  trigger: HibobSyncTrigger;
  triggeredBy: string | null;
  status: HibobSyncStatus;
  startedAt: Date;
  finishedAt: Date | null;
  employeeCount: number | null;
  skipped: number | null;
  error: string | null;
};

const SYNC_SORT_COLUMNS = {
  startedAt: hibobSyncRuns.startedAt,
  // The schedule sorts as "Schedule", among the people.
  triggeredBy: sql`lower(case when ${hibobSyncRuns.trigger} = 'schedule' then 'Schedule' else coalesce(nullif(${users.name}, ''), ${users.email}) end)`,
  status: hibobSyncRuns.status,
} as const;

/**
 * One page of the sync log, newest first unless asked otherwise. The search
 * matches who started it, how, the status and the error.
 */
export async function listHibobSyncRuns(query: ListQuery<HibobSyncSort>): Promise<Page<HibobSyncRunSummary>> {
  const { limit, offset } = pageWindow(query.page);
  const rows = await db
    .select({
      id: hibobSyncRuns.id,
      trigger: hibobSyncRuns.trigger,
      triggeredByName: users.name,
      triggeredByEmail: users.email,
      status: hibobSyncRuns.status,
      startedAt: hibobSyncRuns.startedAt,
      finishedAt: hibobSyncRuns.finishedAt,
      employeeCount: hibobSyncRuns.employeeCount,
      skipped: hibobSyncRuns.skipped,
      error: hibobSyncRuns.error,
    })
    .from(hibobSyncRuns)
    .leftJoin(users, eq(users.id, hibobSyncRuns.triggeredBy))
    .where(
      searchAny(query.q, [
        users.name,
        users.email,
        sql`${hibobSyncRuns.trigger}::text`,
        sql`${hibobSyncRuns.status}::text`,
        hibobSyncRuns.error,
      ]),
    )
    .orderBy(
      ...orderFor(SYNC_SORT_COLUMNS[query.sort], query.dir, desc(hibobSyncRuns.startedAt), hibobSyncRuns.id),
    )
    .limit(limit)
    .offset(offset);
  const staleBefore = Date.now() - STALE_MS;
  return toPage(rows.map(({ triggeredByName, triggeredByEmail, ...rest }) => ({
    ...rest,
    triggeredBy: triggeredByName ?? triggeredByEmail,
    // The next sync closes it for good; until then, say what happened.
    ...(rest.status === "running" && rest.startedAt.getTime() < staleBefore
      ? { status: "failed" as const, error: "Did not finish — the server stopped mid-sync." }
      : {}),
  })), query.page);
}

/** Whether a sync is running now: one marked running that has not gone stale. */
export async function syncInProgress(): Promise<boolean> {
  const [row] = await db
    .select({ id: hibobSyncRuns.id })
    .from(hibobSyncRuns)
    .where(
      and(
        eq(hibobSyncRuns.status, "running"),
        sql`${hibobSyncRuns.startedAt} >= ${new Date(Date.now() - STALE_MS)}`,
      ),
    )
    .limit(1);
  return Boolean(row);
}
