import pg from "pg";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 3,
});

export type RunRow = {
  id: string;
  workshop_id: string;
  user_id: string;
  status: string;
  gcp_project_id: string | null;
  state_prefix: string;
  ttl_seconds: number;
  slug: string;
  tf_source: string;
  title: string;
};

/** Load a run joined with its workshop definition. */
export async function getRun(runId: string): Promise<RunRow | undefined> {
  const { rows } = await pool.query<RunRow>(
    `select r.id, r.workshop_id, r.user_id, r.status, r.gcp_project_id,
            r.state_prefix, w.ttl_seconds, w.slug, w.tf_source, w.title
       from workshop_runs r
       join workshops w on w.id = r.workshop_id
      where r.id = $1`,
    [runId],
  );
  return rows[0];
}

/** Runs whose TTL has elapsed (or that failed) and need teardown. */
export async function expiredRuns(): Promise<RunRow[]> {
  const { rows } = await pool.query<RunRow>(
    `select r.id, r.workshop_id, r.user_id, r.status, r.gcp_project_id,
            r.state_prefix, w.ttl_seconds, w.slug, w.tf_source, w.title
       from workshop_runs r
       join workshops w on w.id = r.workshop_id
      where r.status in ('ready', 'failed')
        and r.expires_at is not null
        and r.expires_at < now()`,
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

export async function setProvisioning(runId: string, projectId: string) {
  await pool.query(
    `update workshop_runs set status = 'provisioning', gcp_project_id = $2 where id = $1`,
    [runId, projectId],
  );
}

export async function setApplying(runId: string) {
  await pool.query(`update workshop_runs set status = 'applying' where id = $1`, [
    runId,
  ]);
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

export async function setFailed(runId: string, error: string, expiresAt: Date) {
  await pool.query(
    `update workshop_runs
        set status = 'failed', error = $2, expires_at = $3
      where id = $1`,
    [runId, error, expiresAt.toISOString()],
  );
}

export async function setDestroying(runId: string) {
  await pool.query(
    `update workshop_runs set status = 'destroying' where id = $1`,
    [runId],
  );
}

export async function setDestroyed(runId: string) {
  await pool.query(
    `update workshop_runs set status = 'destroyed', destroyed_at = now() where id = $1`,
    [runId],
  );
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
