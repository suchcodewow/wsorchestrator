/**
 * The decisions `import-production.ts` makes, without the I/O, so they can be
 * tested. Each of them is a place where getting it wrong either destroys
 * production's workshops or leaves QA without its reaper.
 */

/** What the import works from, taken from the job's environment. */
export type ImportConfig = {
  environment: string;
  source: { project: string; instance: string };
  target: { project: string; instance: string };
  region: string;
  backupId: string;
  finishUrl: string;
  actor: string;
};

/**
 * Read and check the import's configuration, or say why it must not run.
 *
 * The refusals are the guardrail, not input validation. Production must never
 * run this, and neither must a deployment that does not say which one it is: an
 * unset `DEPLOYMENT_ENVIRONMENT` means production everywhere else in the
 * runner. The source and target must differ, because "restore production's
 * backup onto production" is a rollback, and the Backups page already does
 * that with its own safeguards.
 */
export function importConfig(
  env: NodeJS.ProcessEnv,
): { ok: true; config: ImportConfig } | { ok: false; reason: string } {
  const environment = env.DEPLOYMENT_ENVIRONMENT?.trim() ?? "";
  if (!environment) {
    return { ok: false, reason: "DEPLOYMENT_ENVIRONMENT is not set, so this may be production" };
  }
  if (environment === "production") {
    return { ok: false, reason: "this is production; an import only ever runs on QA" };
  }

  const required = {
    PRODUCTION_BACKUP_PROJECT: env.PRODUCTION_BACKUP_PROJECT?.trim(),
    PRODUCTION_BACKUP_INSTANCE: env.PRODUCTION_BACKUP_INSTANCE?.trim(),
    GCP_ADMIN_PROJECT_ID: env.GCP_ADMIN_PROJECT_ID?.trim(),
    CLOUD_SQL_INSTANCE: env.CLOUD_SQL_INSTANCE?.trim(),
    BACKUP_ID: env.BACKUP_ID?.trim(),
    IMPORT_FINISH_URL: env.IMPORT_FINISH_URL?.trim(),
  };
  const missing = Object.entries(required)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length > 0) {
    return { ok: false, reason: `missing ${missing.join(", ")}` };
  }

  const source = {
    project: required.PRODUCTION_BACKUP_PROJECT!,
    instance: required.PRODUCTION_BACKUP_INSTANCE!,
  };
  const target = {
    project: required.GCP_ADMIN_PROJECT_ID!,
    instance: required.CLOUD_SQL_INSTANCE!,
  };
  if (source.project === target.project) {
    return { ok: false, reason: "the production backup is in this deployment's own project" };
  }

  // Cloud SQL backup run ids are int64s. Checked because it is interpolated
  // into a URL.
  if (!/^\d+$/.test(required.BACKUP_ID!)) {
    return { ok: false, reason: `BACKUP_ID "${required.BACKUP_ID}" is not a backup run id` };
  }

  let finish: URL;
  try {
    finish = new URL(required.IMPORT_FINISH_URL!);
  } catch {
    return { ok: false, reason: "IMPORT_FINISH_URL is not a URL" };
  }
  if (finish.protocol !== "https:" && finish.hostname !== "localhost") {
    return { ok: false, reason: "IMPORT_FINISH_URL must be https" };
  }

  return {
    ok: true,
    config: {
      environment,
      source,
      target,
      region: env.GCP_REGION?.trim() || "us-central1",
      backupId: required.BACKUP_ID!,
      finishUrl: finish.toString(),
      actor: env.IMPORT_ACTOR?.trim() || "unknown",
    },
  };
}

/**
 * The database user and password the deployment connects with.
 *
 * A restore replaces the instance's Postgres roles along with its data, so
 * afterwards `appuser` has production's password and every QA connection
 * fails. The import puts QA's password back, and this is where it reads it
 * from: the same `DATABASE_URL` everything else in QA connects with.
 */
export function databaseCredentials(
  url: string | undefined,
): { user: string; password: string } | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const user = decodeURIComponent(parsed.username);
    const password = decodeURIComponent(parsed.password);
    return user && password ? { user, password } : null;
  } catch {
    return null;
  }
}

/** A Cloud SQL Admin API operation, as far as the import reads it. */
export type SqlOperation = {
  name?: string;
  status?: string;
  error?: { errors?: { code?: string; message?: string }[] };
};

export function operationState(
  op: SqlOperation,
): { state: "running" } | { state: "done" } | { state: "failed"; message: string } {
  if (op.status !== "DONE") return { state: "running" };
  const errors = op.error?.errors ?? [];
  if (errors.length === 0) return { state: "done" };
  return {
    state: "failed",
    message: errors.map((e) => [e.code, e.message].filter(Boolean).join(": ")).join("; "),
  };
}

/** One Cloud Run job execution, as far as the import reads it. */
export type Execution = { name?: string; completionTime?: string };

/**
 * Executions still running, other than this one.
 *
 * A restore underneath a reaper mid-teardown leaves that teardown's half-done
 * work recorded nowhere, and a runner mid-provision loses the run it is
 * building. So nothing may be running. The import is itself a `tf-runner`
 * execution, and Cloud Run names it in `CLOUD_RUN_EXECUTION`.
 */
export function otherRunningExecutions(
  executions: Execution[],
  self: string | undefined,
): string[] {
  return executions
    .filter((e) => !e.completionTime)
    .map((e) => e.name ?? "")
    .filter((name) => name && (!self || !name.endsWith(`/executions/${self}`)));
}

/**
 * Whether a failed API call was refused before it did anything.
 *
 * A 4xx is Cloud SQL saying no: a missing permission on production's backup,
 * an instance already busy. The restore never began, so the database is still
 * QA's own and the triggers can resume. Anything else (a 5xx, a timeout, no
 * response at all) might have started it, and is treated as though it had.
 */
export function refusedOutright(err: unknown): boolean {
  const status = (err as { response?: { status?: number } })?.response?.status;
  return typeof status === "number" && status >= 400 && status < 500;
}

/**
 * Whether to resume the Cloud Scheduler triggers the import paused.
 *
 * Resuming is safe once the imported rows carry `environment = 'production'`,
 * since from then on the reaper and the provisioner skip them. It is also safe
 * if the restore never started, because the database is still QA's own. In
 * between, the database may hold production's live workshops with nothing
 * marking them as production's, and a reaper tick would tear them down. So
 * the triggers stay paused and the log says how to finish by hand.
 */
export function shouldResume(progress: {
  restoreStarted: boolean;
  quarantined: boolean;
}): boolean {
  return !progress.restoreStarted || progress.quarantined;
}

/**
 * The statements that make an imported database safe for QA's runner, run the
 * moment the restore finishes.
 *
 * Only what has to happen before the triggers resume: everything the reaper
 * or the provisioner would act on. Written against production's schema as it
 * may be, which can be older than QA's. The column may not exist yet, so it is
 * added; 0035 is idempotent and will find it there.
 * The full clean-up (migrations, credentials, roles) is the app's, in its
 * finish endpoint.
 */
export const QUARANTINE_SQL = [
  `alter table workshop_runs add column if not exists environment text`,
  `update workshop_runs set environment = 'production'`,
  // Production's sign-ins, which would otherwise be valid cookies for QA.
  `delete from sessions`,
  // The reaper's second duty is overwriting these secrets in Harness, which QA
  // shares. Production's list is production's to work through. Guarded,
  // because a production backup older than the table would not have it.
  `do $$ begin
     if to_regclass('public.harness_deployed_secrets') is not null then
       delete from harness_deployed_secrets;
     end if;
   end $$`,
];
