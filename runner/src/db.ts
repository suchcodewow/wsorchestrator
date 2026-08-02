import pg from "pg";

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
};

const RUN_COLUMNS = `id, user_id, name, mode, slug, user_count, clouds, status,
                     org_unit_path, gcp_project_id, state_prefix, ttl_seconds,
                     expires_at`;

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

export async function setProvisioning(runId: string) {
  await pool.query(
    `update workshop_runs set status = 'provisioning' where id = $1`,
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

export async function deleteAccounts(runId: string) {
  await pool.query(`delete from workshop_accounts where run_id = $1`, [runId]);
}

/**
 * Atomically claim scheduled runs whose start time has arrived. The
 * status='scheduled' guard means two concurrent scheduler executions can't
 * claim the same run twice.
 */
export async function claimDueScheduledRuns(): Promise<{ id: string }[]> {
  const { rows } = await pool.query<{ id: string }>(
    `update workshop_runs
        set status = 'requested'
      where status = 'scheduled'
        and scheduled_start is not null
        and scheduled_start <= now()
      returning id`,
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

export async function endPool() {
  await pool.end();
}
