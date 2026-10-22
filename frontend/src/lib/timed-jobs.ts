/**
 * The Timed Jobs tab's data and the wrapper a scheduled route runs inside:
 * whether a job is switched on, and how its last run went. The jobs
 * themselves are listed in `timed-jobs-registry.ts`; the two Cloud Run jobs
 * (reaper, scheduler) do the same in `runner/src/db.ts`.
 */

import "server-only";

import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { timedJobs, type TimedJobStatus } from "@/db/schema";
import { TIMED_JOBS, timedJobDef, type TimedJobDef } from "@/lib/timed-jobs-registry";

export type TimedJobRow = TimedJobDef & {
  enabled: boolean;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastStatus: TimedJobStatus | null;
  lastDetail: string | null;
};

export async function isTimedJobEnabled(key: string): Promise<boolean> {
  const [row] = await db.select({ enabled: timedJobs.enabled }).from(timedJobs).where(eq(timedJobs.key, key));
  return row?.enabled ?? true;
}

/** Every job with its switch and last run; a fixed handful, so never more than 100. */
export async function listTimedJobs(): Promise<TimedJobRow[]> {
  const rows = await db
    .select()
    .from(timedJobs)
    .where(inArray(timedJobs.key, TIMED_JOBS.map((job) => job.key)))
    .limit(100);
  const byKey = new Map(rows.map((row) => [row.key, row]));
  return TIMED_JOBS.map((job) => {
    const row = byKey.get(job.key);
    return {
      ...job,
      enabled: row?.enabled ?? true,
      lastStartedAt: row?.lastStartedAt?.toISOString() ?? null,
      lastFinishedAt: row?.lastFinishedAt?.toISOString() ?? null,
      lastStatus: row?.lastStatus ?? null,
      lastDetail: row?.lastDetail ?? null,
    };
  });
}

/** Switches a job on or off, or false for a key that is not a job. */
export async function setTimedJobEnabled(actorId: string, key: string, enabled: boolean): Promise<boolean> {
  if (!timedJobDef(key)) return false;
  await db
    .insert(timedJobs)
    .values({ key, enabled, updatedBy: actorId })
    .onConflictDoUpdate({ target: timedJobs.key, set: { enabled, updatedBy: actorId, updatedAt: new Date() } });
  return true;
}

async function recordRun(key: string, status: TimedJobStatus, detail: string | null): Promise<void> {
  const now = new Date();
  const finished = status === "running" ? null : now;
  const set = { lastStartedAt: now, lastFinishedAt: finished, lastStatus: status, lastDetail: detail };
  await db
    .insert(timedJobs)
    .values({ key, ...set })
    .onConflictDoUpdate({
      target: timedJobs.key,
      set: status === "running" || status === "skipped" ? set : { lastFinishedAt: now, lastStatus: status, lastDetail: detail },
    });
}

/**
 * Runs a scheduled route's work if its job is on, and records how it went: a
 * response outside 2xx or a throw is a failure, with the response's `error`
 * as the detail. A job that is off answers `{ skipped: "off" }`, which Cloud
 * Scheduler counts as success. `describe` turns a success body into the
 * detail shown on the tab.
 */
export async function runTimedJob(
  key: string,
  run: () => Promise<Response>,
  describe?: (body: Record<string, unknown>) => string | null,
): Promise<Response> {
  if (!(await isTimedJobEnabled(key))) {
    await recordRun(key, "skipped", "Switched off").catch(() => {});
    return Response.json({ skipped: "off" });
  }
  await recordRun(key, "running", null).catch(() => {});
  try {
    const res = await run();
    const body = (await res.clone().json().catch(() => ({}))) as Record<string, unknown>;
    if (res.ok) {
      await recordRun(key, "succeeded", describe?.(body) ?? null).catch(() => {});
    } else {
      const reason = typeof body.error === "string" ? body.error : `status ${res.status}`;
      await recordRun(key, "failed", reason).catch(() => {});
    }
    return res;
  } catch (err) {
    await recordRun(key, "failed", err instanceof Error ? err.message : String(err)).catch(() => {});
    throw err;
  }
}
