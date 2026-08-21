import pg from "pg";
import { PROVISION_LEAD_HOURS } from "./config.js";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 3,
});

export type Cloud = "aws" | "azure" | "gcp";

/** Mirrors the `event_mode` enum in the frontend's Drizzle schema. */
export type EventMode = "workshop" | "challenge";

export type RunRow = {
  id: string;
  user_id: string;
  name: string;
  mode: EventMode;
  slug: string;
  user_count: number;
  clouds: Cloud[];
  status: string;
  org_unit_path: string | null;
  gcp_project_id: string | null;
  state_prefix: string;
  ttl_seconds: number;
  expires_at: Date | null;
  outputs: Record<string, unknown> | null;
};

const RUN_COLUMNS = `id, user_id, name, mode, slug, user_count, clouds, status,
                     org_unit_path, gcp_project_id, state_prefix, ttl_seconds,
                     expires_at, outputs`;

export async function getRun(runId: string): Promise<RunRow | undefined> {
  const { rows } = await pool.query<RunRow>(
    `select ${RUN_COLUMNS} from workshop_runs where id = $1`,
    [runId],
  );
  return rows[0];
}

/**
 * Runs the reaper should tear down. Destruction happens for exactly two
 * reasons, and nothing else — a failure never triggers it:
 *
 *   1. Someone asked to delete the workshop in the UI (`delete_requested`).
 *   2. A live (`ready`) workshop has passed its real end time (`expires_at`,
 *      set only when it went ready and only ever pushed later, never to "now").
 *
 * `destroying` is included so a teardown that failed part-way (e.g. Workspace
 * lagging behind an account deletion) is retried rather than stranded — it was
 * already triggered by one of the two reasons above.
 */
export async function reapableRuns(): Promise<RunRow[]> {
  const { rows } = await pool.query<RunRow>(
    `select ${RUN_COLUMNS}
       from workshop_runs
      where delete_requested
         or status = 'destroying'
         or (status = 'ready' and expires_at is not null and expires_at < now())`,
  );
  return rows;
}

export async function log(
  runId: string,
  stream: "stdout" | "stderr" | "system",
  message: string,
): Promise<void> {
  await pool.query(
    `insert into run_logs (run_id, stream, message) values ($1, $2, $3)`,
    [runId, stream, message],
  );
}

/**
 * Start (or restart) a provision. The previous attempt's `error` is cleared
 * here rather than on success: a run that failed, was fixed, and re-provisioned
 * would otherwise sit at `ready` still showing the error it no longer has.
 */
export async function setProvisioning(runId: string) {
  await pool.query(
    `update workshop_runs set status = 'provisioning', error = null where id = $1`,
    [runId],
  );
}

export async function setOrgUnitPath(runId: string, orgUnitPath: string) {
  await pool.query(`update workshop_runs set org_unit_path = $2 where id = $1`, [
    runId,
    orgUnitPath,
  ]);
}

export async function setApplying(runId: string, projectId: string | null) {
  await pool.query(
    `update workshop_runs set status = 'applying', gcp_project_id = $2 where id = $1`,
    [runId, projectId],
  );
}

export async function setReady(
  runId: string,
  outputs: Record<string, unknown>,
  expiresAt: Date,
) {
  await pool.query(
    `update workshop_runs
        set status = 'ready', outputs = $2::jsonb, expires_at = $3
      where id = $1`,
    [runId, JSON.stringify(outputs), expiresAt.toISOString()],
  );
}

/**
 * Mark a first provision as failed. Deliberately does NOT set `expires_at`: a
 * failure must never make the reaper destroy anything on its own. A failed run
 * sits on the calendar with its error until someone deletes it in the UI, which
 * is what then triggers cleanup of whatever partial resources it created.
 */
export async function setFailed(runId: string, error: string) {
  await pool.query(
    `update workshop_runs set status = 'failed', error = $2 where id = $1`,
    [runId, error],
  );
}

/**
 * Record a failure on a workshop that was already live (a grow or retry) while
 * leaving it intact: status back to `ready`, the error surfaced, and — crucially
 * — the original `expires_at` untouched. Overwriting that with "now" (as
 * `setFailed` does for a first provision) would hand a healthy workshop to the
 * reaper over a transient hiccup, tearing down accounts and clouds that were
 * fine. The attempted change simply did not take; what already existed stays.
 */
export async function setLiveError(runId: string, error: string) {
  await pool.query(
    `update workshop_runs set status = 'ready', error = $2 where id = $1`,
    [runId, error],
  );
}

export async function setDestroying(runId: string) {
  await pool.query(
    `update workshop_runs set status = 'destroying' where id = $1`,
    [runId],
  );
}

/**
 * Finish a teardown.
 *
 * A run somebody deleted is removed outright — its accounts and logs go with
 * it through the cascade. The row had to survive this long because it is the
 * only record of what there was to tear down; now that nothing is left, the
 * delete they asked for can actually happen. Everything else is marked
 * destroyed and stays on the calendar.
 *
 * Callers must log *before* calling this: run_logs references the run, so a
 * line written after the delete would have nothing to hang off.
 */
export async function setDestroyed(runId: string) {
  const { rowCount } = await pool.query(
    `delete from workshop_runs where id = $1 and delete_requested`,
    [runId],
  );
  if (rowCount && rowCount > 0) return;

  await pool.query(
    `update workshop_runs set status = 'destroyed', destroyed_at = now() where id = $1`,
    [runId],
  );
}

/**
 * One thing this run has built, as the UI should name it.
 *
 * `key` is the identity within the run and kind — the cloud for a delegate,
 * the empty string for the one-per-run items — so re-recording updates the row
 * rather than adding another. `done`/`total` are for the things created one at
 * a time: they count up in place instead of writing a row per attendee, which
 * is the pile-up this table exists to avoid.
 */
export type Resource = {
  kind: string;
  key?: string;
  label: string;
  detail?: string | null;
  url?: string | null;
  done?: number;
  total?: number;
};

/**
 * Record something the run has actually created, the moment the provider
 * confirms it.
 *
 * Written as it happens rather than collected at the end: this is what the run
 * page shows an organizer watching a ten-minute build, so a resource that is
 * only reported once everything finishes is a resource they had no way to see.
 *
 * Upsert, because a retried or grown run re-walks ground it already covered
 * and must not list the same cluster twice.
 */
export async function recordResource(runId: string, r: Resource) {
  await pool.query(
    `insert into run_resources (run_id, kind, key, label, detail, url, done, total)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (run_id, kind, key) do update
        set label = excluded.label,
            detail = excluded.detail,
            url = excluded.url,
            done = excluded.done,
            total = excluded.total,
            updated_at = now()`,
    [
      runId,
      r.kind,
      r.key ?? "",
      r.label,
      r.detail ?? null,
      r.url ?? null,
      r.done ?? null,
      r.total ?? null,
    ],
  );
}

/**
 * Forget what a run built. Called at the end of a teardown: the table says
 * what is standing right now, so rows that outlived their resources would have
 * the page claim a cluster that is gone.
 */
export async function deleteResources(runId: string) {
  await pool.query(`delete from run_resources where run_id = $1`, [runId]);
}

/** Record an attendee account so the organizer can hand out its credentials. */
export async function addAccount(
  runId: string,
  email: string,
  tempPassword: string,
) {
  await pool.query(
    `insert into workshop_accounts (run_id, email, temp_password)
     values ($1, $2, $3)`,
    [runId, email, tempPassword],
  );
}

/**
 * Email of the user who created a run, so they can be granted account admin —
 * the instructor role the reference script gives an event's owner.
 *
 * The `users.email` column is nullable, so a creator without a recorded address
 * comes back undefined and the caller skips the grant rather than failing.
 */
export async function runCreatorEmail(
  runId: string,
): Promise<string | undefined> {
  const { rows } = await pool.query<{ email: string | null }>(
    `select u.email
       from workshop_runs r
       join users u on u.id = r.user_id
      where r.id = $1`,
    [runId],
  );
  return rows[0]?.email ?? undefined;
}

export async function accountsFor(runId: string): Promise<{ email: string }[]> {
  const { rows } = await pool.query<{ email: string }>(
    `select email from workshop_accounts where run_id = $1 order by id`,
    [runId],
  );
  return rows;
}

/**
 * Accounts with their temp passwords, for clouds that provision a native user
 * of their own (Azure Entra, AWS IAM) using the same credential the Google
 * account already has. GCP does not need this — its authorization binds the
 * Google identity directly rather than minting a parallel account.
 */
export async function accountsWithPasswordsFor(
  runId: string,
): Promise<{ email: string; tempPassword: string }[]> {
  const { rows } = await pool.query<{ email: string; temp_password: string }>(
    `select email, temp_password from workshop_accounts where run_id = $1 order by id`,
    [runId],
  );
  return rows.map((r) => ({ email: r.email, tempPassword: r.temp_password }));
}

/**
 * Record the Entra Temporary Access Pass issued to one attendee.
 *
 * Kept because Entra returns a pass exactly once, at creation — there is no
 * reading it back — and it is the credential the attendee signs into the Azure
 * portal with. Matched on address rather than id because the caller is working
 * from the roster Terraform was given, which is a list of addresses.
 */
export async function setAzureAccessPass(
  runId: string,
  email: string,
  pass: string,
  expiresAt: Date,
) {
  await pool.query(
    `update workshop_accounts
        set azure_access_pass = $3, azure_access_pass_expires_at = $4
      where run_id = $1 and email = $2`,
    [runId, email, pass, expiresAt.toISOString()],
  );
}

export async function deleteAccounts(runId: string) {
  await pool.query(`delete from workshop_accounts where run_id = $1`, [runId]);
}

/**
 * Atomically claim scheduled runs due to provision: those whose start time is
 * within `PROVISION_LEAD_HOURS` from now, so everything is built and ready by
 * the time the workshop actually starts. The status='scheduled' guard means
 * two concurrent scheduler executions can't claim the same run twice.
 */
export async function claimDueScheduledRuns(): Promise<{ id: string }[]> {
  const { rows } = await pool.query<{ id: string }>(
    `update workshop_runs
        set status = 'requested'
      where status = 'scheduled'
        and scheduled_start is not null
        and scheduled_start <= now() + $1::interval
      returning id`,
    [`${PROVISION_LEAD_HOURS} hours`],
  );
  return rows;
}

/** Put a run back to scheduled so the next tick retries triggering it. */
export async function setScheduledBack(runId: string) {
  await pool.query(
    `update workshop_runs set status = 'scheduled' where id = $1`,
    [runId],
  );
}

/**
 * Namespace for the reaper's per-run advisory locks. Arbitrary — it only has
 * to be distinct from any other advisory lock this database might grow, and
 * pairing it with the run's hash keeps the two-key form from colliding with a
 * bare single-key lock somebody adds later.
 */
const REAP_LOCK_NAMESPACE = 0x52454150; // "REAP"

/** How often the lock-holding session is pinged so nothing reaps it as idle. */
const LOCK_KEEPALIVE_MS = 60_000;

/**
 * Run `fn` holding an exclusive lock on `runId`, or skip it (returning false)
 * if another execution already holds one.
 *
 * The reaper fires every few minutes but a teardown can run far longer than
 * that — an AWS account close or a GKE delete is many minutes on its own — so
 * ticks overlap routinely, and `reapableRuns` hands every one of them the same
 * `destroying` row. Without this, two containers tear down one run in
 * parallel: the tofu half collides on the state lock, and the half that has no
 * lock at all (Harness projects, Workspace accounts) double-deletes, so each
 * execution fails on the other's work and the run ping-pongs across ticks
 * instead of finishing.
 *
 * The lock is session-scoped rather than a status column or a lease timestamp,
 * because that makes the crash case correct for free: if the container is
 * killed — the 30-minute job timeout, an OOM — the connection dies with it and
 * Postgres drops the lock, so the next tick picks the run up immediately
 * rather than waiting out a lease that nothing is left alive to renew.
 *
 * Skipping is the right outcome, not a failure: the execution that holds the
 * lock is still working the run, and whatever it doesn't finish is retried on
 * the next tick.
 */
export async function withRunLock(
  runId: string,
  fn: () => Promise<void>,
): Promise<boolean> {
  const client = await pool.connect();
  let locked = false;
  let keepalive: NodeJS.Timeout | undefined;

  try {
    const { rows } = await client.query<{ locked: boolean }>(
      `select pg_try_advisory_lock($1::int, hashtext($2)) as locked`,
      [REAP_LOCK_NAMESPACE, runId],
    );
    locked = rows[0]?.locked ?? false;
    if (!locked) return false;

    // The session sits idle for the whole teardown; a periodic ping keeps any
    // connection-idle timeout between here and Postgres from cutting it and
    // silently handing the lock to another execution mid-destroy.
    keepalive = setInterval(() => {
      void client.query("select 1").catch(() => {});
    }, LOCK_KEEPALIVE_MS);

    await fn();
    return true;
  } finally {
    if (keepalive) clearInterval(keepalive);
    if (locked) {
      await client
        .query(`select pg_advisory_unlock($1::int, hashtext($2))`, [
          REAP_LOCK_NAMESPACE,
          runId,
        ])
        .catch(() => {});
    }
    client.release();
  }
}

export async function endPool() {
  await pool.end();
}
