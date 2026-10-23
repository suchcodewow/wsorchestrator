/**
 * The Timed Jobs tab's data, the dispatcher that starts the app's own jobs,
 * and the wrapper each runs inside: whether a job is switched on, when it
 * runs, and how its last run went. The jobs themselves are listed in
 * `timed-jobs-registry.ts`, and what each does is in `timed-job-runs.ts`; the
 * two Cloud Run jobs (reaper, scheduler) record their runs in `runner/src/db.ts`.
 *
 * Cloud Scheduler calls the dispatcher every `TICK_MINUTES`. Each call starts
 * every job whose schedule fell due since the time it last started it for, no
 * more than `CATCH_UP_MINUTES` back, claiming that time first so a second
 * call for the same time starts nothing.
 */

import "server-only";

import { eq, inArray, lt, or, isNull } from "drizzle-orm";
import { db } from "@/db";
import { timedJobs, type TimedJobStatus } from "@/db/schema";
import { describeCron, lastDue, nextDue, parseCron, scheduleProblem } from "@/lib/cron";
import { TIMED_JOB_RUNS, type TimedJobContext } from "@/lib/timed-job-runs";
import { TIMED_JOBS, timedJobDef, type TimedJobDef } from "@/lib/timed-jobs-registry";

/**
 * A job as the tab shows it. `cron`, `timeZone` and `schedule` are the ones it
 * runs on; `defaultCron` and `defaultTimeZone` the registry's.
 */
export type TimedJobRow = TimedJobDef & {
  defaultCron: string;
  defaultTimeZone: string;
  /** Whether an administrator set its schedule, rather than its running on the default. */
  custom: boolean;
  /** When it is next due, for a job on a schedule the app can read; null if not in the coming year. */
  nextRunAt: string | null;
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
  const now = new Date();
  return TIMED_JOBS.map((job) => {
    const row = byKey.get(job.key);
    const { cron, timeZone, custom } = scheduleOf(job, row);
    const parsed = parseCron(cron);
    const next = parsed.ok ? nextDue(parsed.cron, timeZone, now)[0] : undefined;
    return {
      ...job,
      cron,
      timeZone,
      schedule: custom ? (describeCron(cron, timeZone) ?? cron) : job.schedule,
      defaultCron: job.cron,
      defaultTimeZone: job.timeZone,
      custom,
      nextRunAt: next?.toISOString() ?? null,
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

/** The schedule a job runs on: the one set on the tab if it is a dispatched job's and still valid, else the default. */
function scheduleOf(job: TimedJobDef, row: { cron: string | null; timeZone: string | null } | undefined) {
  if (job.via === "dispatcher" && row?.cron && row.timeZone && !scheduleProblem(row.cron, row.timeZone)) {
    return { cron: row.cron, timeZone: row.timeZone, custom: true };
  }
  return { cron: job.cron, timeZone: job.timeZone, custom: false };
}

export type ScheduleResult =
  | { ok: true }
  | { ok: false; error: "not_found" }
  | { ok: false; error: "fixed_schedule" }
  | { ok: false; error: "invalid_schedule"; detail: string };

/**
 * Sets when a dispatched job runs, or with null puts it back on its default.
 * Only times from now on count: a time already past is not caught up on.
 */
export async function setTimedJobSchedule(
  actorId: string,
  key: string,
  schedule: { cron: string; timeZone: string } | null,
): Promise<ScheduleResult> {
  const job = timedJobDef(key);
  if (!job) return { ok: false, error: "not_found" };
  if (job.via !== "dispatcher") return { ok: false, error: "fixed_schedule" };
  let cron: string | null = null;
  let timeZone: string | null = null;
  if (schedule) {
    cron = schedule.cron.trim().split(/\s+/).join(" ");
    timeZone = schedule.timeZone.trim();
    const problem = scheduleProblem(cron, timeZone);
    if (problem) return { ok: false, error: "invalid_schedule", detail: problem };
    if (cron === job.cron && timeZone === job.timeZone) cron = timeZone = null;
  }
  const set = { cron, timeZone, scheduledFor: new Date(), updatedBy: actorId, updatedAt: new Date() };
  await db
    .insert(timedJobs)
    .values({ key, ...set })
    .onConflictDoUpdate({ target: timedJobs.key, set });
  return { ok: true };
}

export type DispatchedRun = { key: string; status: number; body: Record<string, unknown> | null };

/**
 * Starts every dispatched job due at `now`, side by side, and answers how each
 * went. A job is due when its schedule fell due within `CATCH_UP_MINUTES` and
 * after the time it was last started for; that time is claimed before the
 * job starts, so of two calls at once only one starts it. A job switched off
 * is still claimed, and recorded as skipped.
 */
export async function dispatchTimedJobs(now: Date, ctx: TimedJobContext): Promise<DispatchedRun[]> {
  const dispatched = TIMED_JOBS.filter((job) => job.via === "dispatcher");
  const rows = await db
    .select()
    .from(timedJobs)
    .where(inArray(timedJobs.key, dispatched.map((job) => job.key)))
    .limit(100);
  const byKey = new Map(rows.map((row) => [row.key, row]));

  const due: TimedJobDef[] = [];
  for (const job of dispatched) {
    const { cron, timeZone } = scheduleOf(job, byKey.get(job.key));
    const parsed = parseCron(cron);
    const at = parsed.ok ? lastDue(parsed.cron, timeZone, now) : null;
    if (!at) continue;
    const claimed = await db
      .insert(timedJobs)
      .values({ key: job.key, scheduledFor: at })
      .onConflictDoUpdate({
        target: timedJobs.key,
        set: { scheduledFor: at },
        setWhere: or(isNull(timedJobs.scheduledFor), lt(timedJobs.scheduledFor, at)),
      })
      .returning({ key: timedJobs.key });
    if (claimed.length > 0) due.push(job);
  }

  return Promise.all(
    due.map(async (job): Promise<DispatchedRun> => {
      const { run, describe } = TIMED_JOB_RUNS[job.key]!;
      try {
        const res = await runTimedJob(job.key, () => run(ctx), describe);
        return { key: job.key, status: res.status, body: (await res.json().catch(() => null)) as Record<string, unknown> | null };
      } catch (err) {
        return { key: job.key, status: 500, body: { error: err instanceof Error ? err.message : String(err) } };
      }
    }),
  );
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
 * Runs a job's work if it is on, and records how it went: a response outside
 * 2xx or a throw is a failure, with the response's `error` as the detail, and
 * a 2xx `{ skipped: reason }` a skip, with the reason. A job that is off
 * answers `{ skipped: "off" }`. `describe` turns a success body into the
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
    if (res.ok && typeof body.skipped === "string") {
      await recordRun(key, "skipped", body.skipped).catch(() => {});
    } else if (res.ok) {
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
