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
  /** Build the Harness org and the catalog only — no Terraform. */
  harness_only: boolean;
  /** Candidate component set to overlay on the baseline, if any. */
  component_set_id: string | null;
  ttl_seconds: number;
  expires_at: Date | null;
  outputs: Record<string, unknown> | null;
  /** How many teardown attempts this run has had, in total. */
  destroy_attempts: number;
  /** Set while an attempt owns this teardown; see `claimDestroy`. */
  destroy_started_at: Date | null;
};

const RUN_COLUMNS = `id, user_id, name, mode, slug, user_count, clouds, status,
                     org_unit_path, gcp_project_id, state_prefix, harness_only,
                     component_set_id, ttl_seconds, expires_at, outputs,
                     destroy_attempts, destroy_started_at`;

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
 * `destroying` is included, but no longer so the teardown can be *retried* — a
 * failed teardown is flagged, not repeated (see `destroy-policy.ts`). It is here
 * because a run mid-attempt is in that status, and because an attempt that was
 * killed leaves the run there with a claim still set: selecting it is what lets
 * `claimDestroy` notice the death and flag it.
 *
 * `destroy_failed` has to be excluded explicitly. A run in that state usually
 * also has `delete_requested` set — that is what started the teardown — so the
 * first clause matches it forever otherwise, and the terminal state would not be
 * terminal. This is the whole of the original bug in one line.
 */
export async function reapableRuns(): Promise<RunRow[]> {
  const { rows } = await pool.query<RunRow>(
    `select ${RUN_COLUMNS}
       from workshop_runs
      where (
              delete_requested
           or status = 'destroying'
           or (status = 'ready' and expires_at is not null and expires_at < now())
            )
        and status <> 'destroy_failed'`,
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

/**
 * Take ownership of a teardown attempt, or report that the last one died.
 *
 * The claim is written *before* any destroy work starts, and cleared on every way
 * out of it — success, or a caught failure. So a claim that is still set means the
 * previous attempt neither finished nor recorded a failure, which for a process is
 * only possible if it was killed: the 1800s job timeout, an OOM, a rolled deploy.
 *
 * That inference needs one thing to be sound, and it is the caller's job: this must
 * be called while holding the run's advisory lock. `withRunLock` takes a
 * session-scoped `pg_try_advisory_lock`, which Postgres releases when the
 * connection dies — so if a destroy really is still running elsewhere, the lock is
 * held, the caller never gets here, and the run is skipped rather than declared
 * dead. Holding the lock *and* seeing a claim is proof the claimant is gone.
 *
 * The update is a single statement rather than a read then a write, so two reapers
 * racing the same run cannot both come away thinking they claimed it.
 */
export async function claimDestroy(
  runId: string,
): Promise<"claimed" | "abandoned"> {
  const { rows } = await pool.query<{ destroy_attempts: number }>(
    `update workshop_runs
        set status = 'destroying',
            destroy_started_at = now(),
            destroy_attempts = destroy_attempts + 1
      where id = $1
        and destroy_started_at is null
      returning destroy_attempts`,
    [runId],
  );
  return rows.length > 0 ? "claimed" : "abandoned";
}

/**
 * Stop tearing this run down and leave it for a person. The only outcome of a
 * teardown that does not succeed.
 *
 * The error is stored on the row rather than only logged, because the run page
 * shows `error` and nobody reads a log they have no reason to open. `expires_at`,
 * `delete_requested` and the roster are all left exactly as they are: the run may
 * still own cloud resources, and every one of those fields is a record of what
 * there is left to remove. `retryTeardown` in the frontend is what clears this.
 *
 * The claim is released, so a person's retry starts clean. `destroy_attempts` is
 * not reset — it counts how many times this teardown has been attempted in total,
 * which is the number worth seeing next to a run that has failed twice.
 */
export async function setDestroyFailed(
  runId: string,
  error: string,
): Promise<void> {
  await pool.query(
    `update workshop_runs
        set status = 'destroy_failed',
            destroy_started_at = null,
            error = $2
      where id = $1`,
    [runId, error],
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

  // The claim is released and the error a previous attempt may have left is
  // cleared: this teardown succeeded, so a row that keeps showing the attempt
  // that did not would be lying about a run with nothing left to tear down.
  // `destroy_attempts` stays — it is the record of how many tries this took.
  await pool.query(
    `update workshop_runs
        set status = 'destroyed',
            destroyed_at = now(),
            destroy_started_at = null,
            error = null
      where id = $1`,
    [runId],
  );
}

/* ------------------------------------------------------------------ *
 * The Harness component catalog
 * ------------------------------------------------------------------ */

/** Mirrors `COMPONENT_KINDS` in the frontend's Drizzle schema. */
export type ComponentKind =
  | "secret_text"
  | "secret_file"
  | "connector"
  | "template";

/**
 * One secret, connector, or template the runner creates in a workshop's org.
 *
 * The row as the runner needs it: `spec`, `requires`, and `dependsOn` come back
 * from `jsonb` already parsed, so nothing here re-parses them.
 */
export type Component = {
  identifier: string;
  kind: ComponentKind;
  scope: string;
  name: string;
  spec: unknown;
  requires: string[];
  dependsOn: string[];
  /** Templates only: the version label this component creates. */
  versionLabel: string;
  builtin: boolean;
};

/** A `jsonb` column that should hold an array of strings, defensively read. */
const stringArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

/**
 * The component catalog to deploy: the published baseline, optionally overlaid
 * by one candidate set.
 *
 * The overlay is by identifier, which is what lets a candidate propose
 * *replacing* a baseline component rather than only adding beside it — a
 * contributor fixing the GCP connector proposes a row with that identifier, and
 * the sandbox run applies theirs instead of the baseline's.
 *
 * Ordering here is only for determinism; the real order comes from the
 * dependency graph in `components.ts`.
 */
export async function loadCatalog(setId?: string): Promise<Component[]> {
  const { rows } = await pool.query<{
    identifier: string;
    kind: ComponentKind;
    scope: string;
    name: string;
    spec: unknown;
    requires: unknown;
    depends_on: unknown;
    version_label: string;
    builtin: boolean;
  }>(
    `select distinct on (identifier)
            identifier, kind, scope, name, spec, requires, depends_on,
            version_label, builtin
       from harness_components
      where set_id is null or set_id = $1::uuid
      -- A candidate row wins over the baseline row with the same identifier.
      order by identifier, (set_id is null)`,
    [setId ?? null],
  );

  return rows.map((r) => ({
    identifier: r.identifier,
    kind: r.kind,
    scope: r.scope,
    name: r.name,
    spec: r.spec,
    requires: stringArray(r.requires),
    dependsOn: stringArray(r.depends_on),
    versionLabel: r.version_label,
    builtin: r.builtin,
  }));
}

/* ------------------------------------------------------------------ *
 * Administrator-managed org secrets
 * ------------------------------------------------------------------ */

/** Mirrors `ORG_SECRET_KINDS` in the frontend's Drizzle schema. */
export type OrgSecretKind = "text" | "file";

/**
 * One secret an administrator typed into the settings page, still sealed.
 *
 * Not a catalog `Component`, even though both end up as an org secret. A
 * component carries `${...}` bindings resolved against the run and a place in a
 * dependency graph, because its value is something this run *produced* — an AWS
 * key the apply just minted. These are constants somebody entered once: a
 * licence key, a shared service account, a webhook URL. Nothing about them
 * depends on the run, so they need none of that machinery, and putting them
 * through it would mean a graph node whose only edge is to nothing.
 */
export type OrgSecret = {
  identifier: string;
  kind: OrgSecretKind;
  /** What the file was called when it was uploaded. Null for a text secret. */
  fileName: string | null;
  /** The sealed value — see `secret-box.ts`. */
  secret: Buffer;
};

/**
 * Every org secret the site has, in a stable order.
 *
 * Site-wide, so nothing here is scoped by run: these are applied to every
 * workshop's organization, which is the point of them living in settings rather
 * than on a run.
 */
export async function loadOrgSecrets(): Promise<OrgSecret[]> {
  const { rows } = await pool.query<{
    identifier: string;
    kind: OrgSecretKind;
    file_name: string | null;
    secret: Buffer;
  }>(
    `select identifier, kind, file_name, secret
       from harness_org_secrets
      order by identifier`,
  );

  return rows.map((r) => ({
    identifier: r.identifier,
    kind: r.kind,
    fileName: r.file_name,
    secret: r.secret,
  }));
}

/* ------------------------------------------------------------------ *
 * Administrator-listed GitHub repositories
 * ------------------------------------------------------------------ */

/** Mirrors `REPO_SCOPES` in the frontend's Drizzle schema. */
export type RepoScope = "org" | "project";

/**
 * One GitHub repository every workshop imports into Harness Code.
 *
 * `providerRepo` is the `owner/name` the importer takes; `url` is only what the
 * administrator typed, kept for the log so a failure names the address they
 * would go and check. `scope` decides how many copies get made: `"org"` means
 * one in the event's organization, `"project"` means one in every attendee's own
 * project.
 */
export type Repo = {
  identifier: string;
  providerRepo: string;
  scope: RepoScope;
  url: string;
};

/**
 * Every repository the site imports, in a stable order.
 *
 * Site-wide, like the org secrets above and for the same reason: an
 * administrator lists a repository once and every workshop gets it.
 */
export async function loadRepos(): Promise<Repo[]> {
  const { rows } = await pool.query<{
    identifier: string;
    provider_repo: string;
    scope: RepoScope;
    url: string;
  }>(
    `select identifier, provider_repo, scope, url
       from harness_repos
      order by identifier`,
  );

  return rows.map((r) => ({
    identifier: r.identifier,
    providerRepo: r.provider_repo,
    scope: r.scope,
    url: r.url,
  }));
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

/* ------------------------------------------------------------------ *
 * Deployed content's credentials, and taking them back out
 * ------------------------------------------------------------------ */

/**
 * One org secret this site's content deploy left in an account we do not own,
 * with the token that can reach it.
 *
 * The ledger is written by the app (`frontend/src/lib/harness-scrub.ts`) when a
 * deploy puts a real value into somebody else's organization; this is the read
 * the sweep does a week later. `token_secret` is the sealed PAT out of
 * `harness_tokens` — sealed, because opening it is `secret-box.ts`'s job and it
 * should be held in plaintext for as few lines as possible. Null when the token
 * has since been forgotten, which the sweep has to report rather than retry.
 */
export type DueScrub = {
  id: string;
  account_id: string;
  org_identifier: string;
  secret_identifier: string;
  /** `text` or `file` — which Harness endpoint the overwrite has to use. */
  kind: string;
  /** Harness's own `updatedAt` when we wrote it, for the modified-since guard. */
  harness_updated_at: Date | null;
  written_at: Date;
  token_secret: Buffer | null;
};

/**
 * Every deployed secret whose week is up.
 *
 * `pending` rows past their deadline are the normal case. `failed` ones are
 * retried, but no more than hourly: a scrub fails for reasons that pass — a
 * cluster that was unreachable for a minute — and for reasons that never will,
 * like a revoked token, and retrying the second kind every tick would put a
 * doomed request per row into every reaper run for the rest of the deployment's
 * life. An hour is often enough that a transient failure clears on its own and
 * rare enough to be free.
 *
 * A row whose token is gone gets exactly one verdict written and then drops out
 * — `checked_at is null` is the "never reported on" test. Nothing can scrub it,
 * so the useful outcome is the note on the row telling a person to do it by
 * hand, and repeating that note hourly would not make it truer.
 *
 * `scrubbed` and `skipped` are terminal and never selected: the first is done,
 * and the second means the value in Harness belongs to the account's owner now.
 */
export async function dueScrubs(): Promise<DueScrub[]> {
  const { rows } = await pool.query<DueScrub>(
    `select s.id,
            s.account_id,
            s.org_identifier,
            s.secret_identifier,
            s.kind,
            s.harness_updated_at,
            s.written_at,
            t.secret as token_secret
       from harness_deployed_secrets s
       left join harness_tokens t on t.id = s.token_id
      where s.scrub_after < now()
        and (
              s.status = 'pending'
              or (s.status = 'failed'
                  and (s.checked_at is null or s.checked_at < now() - interval '1 hour'))
            )
        and (t.secret is not null or s.checked_at is null)
      order by s.scrub_after`,
  );
  return rows;
}

/** Write down what became of one deployed secret. */
export async function recordScrub(
  id: string,
  status: "scrubbed" | "skipped" | "failed",
  note: string | null,
): Promise<void> {
  await pool.query(
    `update harness_deployed_secrets
        set status = $2, note = $3, checked_at = now()
      where id = $1`,
    [id, status, note],
  );
}

/**
 * Namespace for the reaper's per-run advisory locks. Arbitrary — it only has
 * to be distinct from any other advisory lock this database might grow, and
 * pairing it with the run's hash keeps the two-key form from colliding with a
 * bare single-key lock somebody adds later.
 */
const REAP_LOCK_NAMESPACE = 0x52454150; // "REAP"

/** The scrub sweep's single lock. One key, because there is one sweep. */
const SCRUB_LOCK_NAMESPACE = 0x53435242; // "SCRB"

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

/**
 * Run `fn` as the only scrub sweep in flight, or skip it (returning false).
 *
 * Overlapping ticks matter more here than they look. Two sweeps that read the
 * same due row both scrub it, and the second one's read shows an `updatedAt` the
 * first one's write moved — which is precisely the signal `modifiedSince` treats
 * as "the account's owner has replaced this", so the row ends up `skipped` with
 * a note blaming a customer for an edit we made ourselves. One lock for the
 * whole sweep rather than one per row: the sweep is short, sequential, and there
 * is nothing to gain from two containers sharing it.
 *
 * Session-scoped for the same reason `withRunLock` is — a killed container drops
 * the lock with its connection instead of leaving a lease nothing will renew.
 *
 * The manual "Scrub now" button in the app does not take this lock, and cannot:
 * it runs in another service, against a pooled connection it does not own. The
 * exposure is a click landing in the same few seconds as a sweep processing that
 * exact row, and the cost is one misleading note on a secret whose value is
 * nonetheless `123` — worth knowing about, not worth a second locking scheme.
 */
export async function withScrubLock(
  fn: () => Promise<void>,
): Promise<boolean> {
  const client = await pool.connect();
  let locked = false;
  let keepalive: NodeJS.Timeout | undefined;

  try {
    const { rows } = await client.query<{ locked: boolean }>(
      `select pg_try_advisory_lock($1::int, hashtext('scrub')) as locked`,
      [SCRUB_LOCK_NAMESPACE],
    );
    locked = rows[0]?.locked ?? false;
    if (!locked) return false;

    keepalive = setInterval(() => {
      void client.query("select 1").catch(() => {});
    }, LOCK_KEEPALIVE_MS);

    await fn();
    return true;
  } finally {
    if (keepalive) clearInterval(keepalive);
    if (locked) {
      await client
        .query(`select pg_advisory_unlock($1::int, hashtext('scrub'))`, [
          SCRUB_LOCK_NAMESPACE,
        ])
        .catch(() => {});
    }
    client.release();
  }
}

export async function endPool() {
  await pool.end();
}
