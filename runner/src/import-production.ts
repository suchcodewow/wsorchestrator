/**
 * Replace QA's database with one of production's backups. QA only.
 *
 * Started from QA's Backups page (`frontend/src/app/api/backups/production`), as
 * a `tf-runner` execution with the args `import-production`. It runs here, not
 * in the app, because a restore takes the database away for several minutes,
 * which is longer than a request lives, and because runner-sa is the identity
 * that can pause the reaper.
 *
 * The danger is the one `docs/environments.md` names. Production's rows name
 * production's live Workspace users, Harness orgs and cloud accounts, which QA
 * shares, and QA's reaper tears down whatever its database lists. So, in order:
 *
 *   1. Refuse anywhere but QA (`importConfig`), and refuse while QA has
 *      workshops of its own standing, which the restore would orphan.
 *   2. Pause the reaper's and provisioner's triggers, then check that no
 *      runner, reaper or provisioner execution is still running.
 *   3. Take an on-demand backup of QA, so the import can be undone from the
 *      Backups page.
 *   4. Restore production's backup, and put QA's database password back.
 *   5. Quarantine: stamp every row `environment = 'production'` and drop
 *      production's sessions. The runner and app ignore those rows from then
 *      on (`environment.ts`).
 *   6. Ask the app to finish: QA's migrations, then the rest of the clean-up.
 *   7. Resume the triggers, unless step 4 started and step 5 did not finish.
 */

import { GoogleAuth } from "google-auth-library";
import pg from "pg";
import {
  endPool,
  runsHoldingResources,
  snapshotUsers,
  type UserSnapshot,
} from "./db.js";
import {
  QUARANTINE_SQL,
  databaseCredentials,
  importConfig,
  operationState,
  otherRunningExecutions,
  refusedOutright,
  shouldResume,
  type Execution,
  type ImportConfig,
  type SqlOperation,
} from "./import-policy.js";

const SQL_API = "https://sqladmin.googleapis.com/sql/v1beta4";

/**
 * The jobs and triggers that act on runs. Fixed names, defined in
 * `infra/admin/runner.tf` and `scheduler.tf`. They are not passed in as
 * configuration, because they would have to be threaded through the very
 * jobs they name.
 */
const JOBS = ["tf-runner", "tf-reaper", "tf-scheduler"];
const TRIGGERS = ["tf-reaper-trigger", "tf-scheduler-trigger"];

/** Must match `PRODUCTION_IMPORT_AUDIENCE` in the app's finish route. */
export const FINISH_AUDIENCE = "workshop-orchestrator/production-import";

const POLL_MS = 10_000;

function say(message: string, extra: Record<string, unknown> = {}) {
  console.log(
    JSON.stringify({
      severity: "NOTICE",
      component: "production-import",
      message,
      ...extra,
    }),
  );
}

function shout(message: string, extra: Record<string, unknown> = {}) {
  console.error(
    JSON.stringify({
      severity: "ERROR",
      component: "production-import",
      message,
      ...extra,
    }),
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const auth = new GoogleAuth({
  scopes: ["https://www.googleapis.com/auth/cloud-platform"],
});

async function call<T>(
  url: string,
  init?: { method?: "GET" | "POST" | "PUT"; data?: unknown },
): Promise<T> {
  const client = await auth.getClient();
  const res = await client.request<T>({
    url,
    method: init?.method ?? "GET",
    ...(init?.data ? { data: init.data } : {}),
  });
  return res.data;
}

/** Wait for a Cloud SQL operation, failing on its error. */
async function waitFor(project: string, op: SqlOperation, what: string) {
  if (!op.name) throw new Error(`${what}: the API returned no operation`);
  const started = Date.now();
  for (;;) {
    const current = await call<SqlOperation>(
      `${SQL_API}/projects/${project}/operations/${op.name}`,
    );
    const state = operationState(current);
    if (state.state === "done") return;
    if (state.state === "failed") throw new Error(`${what} failed: ${state.message}`);
    if (Date.now() - started > 50 * 60_000) {
      throw new Error(`${what} still running after 50 minutes (operation ${op.name})`);
    }
    await sleep(POLL_MS);
  }
}

/* ------------------------------------------------------------------ *
 * Cloud Scheduler
 * ------------------------------------------------------------------ */

function triggerUrl(config: ImportConfig, name: string) {
  return `https://cloudscheduler.googleapis.com/v1/projects/${config.target.project}/locations/${config.region}/jobs/${name}`;
}

/**
 * Pause each trigger, recording in `paused` the ones this call paused. They are
 * recorded as it goes, so a failure halfway still resumes the first one.
 */
async function pauseTriggers(config: ImportConfig, paused: string[]) {
  for (const name of TRIGGERS) {
    const job = await call<{ state?: string }>(triggerUrl(config, name));
    // One somebody had already paused stays paused afterwards. Resuming it
    // would undo a decision that was not the import's.
    if (job.state === "PAUSED") continue;
    await call(`${triggerUrl(config, name)}:pause`, { method: "POST" });
    paused.push(name);
  }
}

async function resumeTriggers(config: ImportConfig, names: string[]) {
  for (const name of names) {
    await call(`${triggerUrl(config, name)}:resume`, { method: "POST" });
  }
}

/* ------------------------------------------------------------------ *
 * Preflight
 * ------------------------------------------------------------------ */

async function runningExecutions(config: ImportConfig): Promise<string[]> {
  const self = process.env.CLOUD_RUN_EXECUTION;
  const running: string[] = [];
  for (const job of JOBS) {
    const data = await call<{ executions?: Execution[] }>(
      `https://run.googleapis.com/v2/projects/${config.target.project}/locations/${config.region}/jobs/${job}/executions?pageSize=50`,
    );
    running.push(...otherRunningExecutions(data.executions ?? [], self));
  }
  return running;
}

async function checkBackup(config: ImportConfig) {
  const backup = await call<{ status?: string; instance?: string }>(
    `${SQL_API}/projects/${config.source.project}/instances/${config.source.instance}/backupRuns/${config.backupId}`,
  );
  if (backup.status !== "SUCCESSFUL") {
    throw new Error(`backup ${config.backupId} is ${backup.status ?? "in an unknown state"}, not SUCCESSFUL`);
  }
}

/* ------------------------------------------------------------------ *
 * The database, once it is production's
 * ------------------------------------------------------------------ */

/**
 * Connect to the restored database, retrying while it comes back up.
 *
 * A fresh client, not the pool: the restore closes every connection the
 * instance had, and the pool was ended before it started.
 */
async function connectRestored(): Promise<pg.Client> {
  let last: unknown;
  for (let attempt = 0; attempt < 18; attempt++) {
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    try {
      await client.connect();
      return client;
    } catch (err) {
      last = err;
      await client.end().catch(() => {});
      await sleep(POLL_MS);
    }
  }
  throw new Error(`could not connect to the restored database: ${String(last)}`);
}

async function quarantine() {
  const client = await connectRestored();
  try {
    await client.query("begin");
    for (const statement of QUARANTINE_SQL) await client.query(statement);
    await client.query("commit");
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    await client.end().catch(() => {});
  }
}

/**
 * Ask the app to finish the import.
 *
 * Retried, because the first requests after a restore can land on an app
 * instance whose pooled connections the restore just closed.
 */
async function finish(config: ImportConfig, snapshot: UserSnapshot[]) {
  const client = await auth.getIdTokenClient(FINISH_AUDIENCE);
  let last: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await client.request<{ migrations?: string[]; removed?: Record<string, number> }>({
        url: config.finishUrl,
        method: "POST",
        data: { backupId: config.backupId, actor: config.actor, snapshot },
        timeout: 300_000,
      });
      return res.data;
    } catch (err) {
      last = err;
      await sleep(15_000);
    }
  }
  throw new Error(`the app's finish step failed: ${String(last)}`);
}

/* ------------------------------------------------------------------ */

export async function importProduction(): Promise<void> {
  const checked = importConfig(process.env);
  if (!checked.ok) throw new Error(`refusing to import a production backup: ${checked.reason}`);
  const config = checked.config;

  const credentials = databaseCredentials(process.env.DATABASE_URL);
  if (!credentials) throw new Error("DATABASE_URL has no user and password to restore");

  say("starting", {
    backupId: config.backupId,
    actor: config.actor,
    source: config.source,
    target: config.target,
  });

  await checkBackup(config);

  const holding = await runsHoldingResources();
  if (holding.length > 0) {
    throw new Error(
      `QA has ${holding.length} workshop(s) that still hold resources, which the restore would orphan: ` +
        holding.map((r) => `${r.name} (${r.status}, ${r.id})`).join(", ") +
        ". Tear them down first.",
    );
  }

  const snapshot = await snapshotUsers();
  say("took a snapshot of QA's users with access", { users: snapshot.length });

  const paused: string[] = [];
  const progress = { restoreStarted: false, quarantined: false };
  try {
    await pauseTriggers(config, paused);
    say("paused triggers", { paused });

    const running = await runningExecutions(config);
    if (running.length > 0) {
      throw new Error(`other executions are still running: ${running.join(", ")}. Try again when they finish.`);
    }

    // Nothing else should touch the database from here, and the restore is
    // about to close every connection anyway.
    await endPool();

    const backupOp = await call<SqlOperation>(
      `${SQL_API}/projects/${config.target.project}/instances/${config.target.instance}/backupRuns`,
      {
        method: "POST",
        data: {
          description: `Before importing production backup ${config.backupId} (${config.actor})`,
        },
      },
    );
    await waitFor(config.target.project, backupOp, "the pre-import backup of QA");
    say("backed up QA; restore that backup from the Backups page to undo this import");

    // Counted as started before the call, since a request that times out may
    // still have started it. Only an outright refusal is known not to have.
    progress.restoreStarted = true;
    let restoreOp: SqlOperation;
    try {
      restoreOp = await call<SqlOperation>(
        `${SQL_API}/projects/${config.target.project}/instances/${config.target.instance}/restoreBackup`,
        {
          method: "POST",
          data: {
            restoreBackupContext: {
              backupRunId: config.backupId,
              instanceId: config.source.instance,
              project: config.source.project,
            },
          },
        },
      );
    } catch (err) {
      if (refusedOutright(err)) progress.restoreStarted = false;
      throw err;
    }
    await waitFor(config.target.project, restoreOp, "the restore");
    say("restored production's backup");

    const userOp = await call<SqlOperation>(
      `${SQL_API}/projects/${config.target.project}/instances/${config.target.instance}/users?name=${encodeURIComponent(credentials.user)}`,
      { method: "PUT", data: { name: credentials.user, password: credentials.password } },
    );
    await waitFor(config.target.project, userOp, `resetting ${credentials.user}'s password`);

    await quarantine();
    progress.quarantined = true;
    say("stamped every imported run as production's and cleared production's sessions");

    const result = await finish(config, snapshot);
    say("the app finished the import", { result });
  } finally {
    if (shouldResume(progress)) {
      await resumeTriggers(config, paused);
      say("resumed triggers", { resumed: paused });
    } else {
      // Do not resume. The database may now list production's workshops with
      // nothing marking them as production's. Leave this loud enough to find.
      shout(
        "LEFT THE REAPER AND PROVISIONER PAUSED: the restore ran but the imported runs " +
          "were not stamped as production's. Before resuming either trigger, run " +
          "`update workshop_runs set environment = 'production'` on QA's database, " +
          "or restore the pre-import backup from the Backups page.",
        { paused },
      );
    }
  }
}
