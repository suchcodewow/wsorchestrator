/**
 * Importing one of production's backups into QA. QA only.
 *
 * The Backups page lists production's backups and starts the import. The
 * import itself runs as a `tf-runner` execution (`runner/src/import-production.ts`),
 * because a restore takes the database away for longer than a request lives.
 * That job pauses QA's reaper and provisioner, backs QA up, restores, stamps
 * every imported run as production's, and then calls back here
 * (`finishProductionImport`) for the rest: QA's migrations, removing
 * production's credentials, and putting QA's own users back in charge.
 *
 * Why it is fenced so heavily is in `docs/environments.md`: QA shares
 * production's Workspace, Harness account and cloud accounts, so a production
 * row that QA's runner believes is its own is a production workshop QA will
 * tear down.
 */

import "server-only";

import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { GoogleAuth } from "google-auth-library";
import pg from "pg";
import { z } from "zod";
import { db } from "@/db";
import {
  backupTarget,
  listBackups,
  type BackupRun,
  type BackupsUnavailable,
} from "@/lib/backups";
import { deploymentEnvironment, isProduction } from "@/lib/deployment";

/** Where production's backups are, or null when this deployment cannot import. */
export function productionSource(): { project: string; instance: string } | null {
  if (isProduction()) return null;
  const project = process.env.PRODUCTION_BACKUP_PROJECT?.trim();
  const instance = process.env.PRODUCTION_BACKUP_INSTANCE?.trim();
  if (!project || !instance) return null;
  // The runner refuses this too. A source in this deployment's own project is
  // a misconfiguration, never production.
  if (project === backupTarget()?.project) return null;
  return { project, instance };
}

export function productionImportAvailable(): boolean {
  return productionSource() !== null && backupTarget() !== null;
}

export async function listProductionBackups(): Promise<
  { ok: true; backups: BackupRun[] } | { ok: false; error: BackupsUnavailable }
> {
  const source = productionSource();
  if (!source) return { ok: false, error: "not_configured" };
  return listBackups(source);
}

/**
 * Runs that hold workshop resources in this deployment. The restore would
 * erase the only record of them, so the import refuses while any exist. The
 * same rule as `runsHoldingResources` in `runner/src/db.ts`, which checks
 * again once the reaper is paused.
 */
export async function localRunsHoldingResources(): Promise<
  { id: string; name: string; status: string }[]
> {
  const { rows } = await db.execute<{ id: string; name: string; status: string }>(sql`
    select id, name, status::text as status
      from workshop_runs
     where status not in ('scheduled', 'destroyed')
       and (environment is null or environment = ${deploymentEnvironment()})
     order by created_at`);
  return rows;
}

export type ImportError =
  | BackupsUnavailable
  | "not_found"
  | "not_restorable"
  | "confirmation_mismatch"
  | "runs_hold_resources";

/** Start the import job. Its progress is in the job's logs, not here. */
export async function startProductionImport(input: {
  backupId: string;
  confirmation: string;
  actorEmail: string;
}): Promise<
  | { ok: true; execution: string | null }
  | { ok: false; error: ImportError; holding?: { id: string; name: string; status: string }[] }
> {
  const target = backupTarget();
  const appUrl = process.env.AUTH_URL?.replace(/\/+$/, "");
  const job = process.env.TF_RUNNER_JOB;
  if (!productionImportAvailable() || !target || !appUrl || !job) {
    return { ok: false, error: "not_configured" };
  }

  // QA's instance, not production's: what is being replaced is what has to be
  // typed.
  if (input.confirmation.trim() !== target.instance) {
    return { ok: false, error: "confirmation_mismatch" };
  }

  const listed = await listProductionBackups();
  if (!listed.ok) return { ok: false, error: listed.error };
  const backup = listed.backups.find((b) => b.id === input.backupId);
  if (!backup) return { ok: false, error: "not_found" };
  if (backup.status !== "SUCCESSFUL") return { ok: false, error: "not_restorable" };

  const holding = await localRunsHoldingResources();
  if (holding.length > 0) return { ok: false, error: "runs_hold_resources", holding };

  const region = process.env.GCP_REGION ?? "us-central1";
  try {
    const client = await new GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    }).getClient();
    const res = await client.request<{ metadata?: { name?: string } }>({
      url: `https://${region}-run.googleapis.com/v2/projects/${target.project}/locations/${region}/jobs/${job}:run`,
      method: "POST",
      data: {
        overrides: {
          containerOverrides: [
            {
              args: ["import-production"],
              env: [
                { name: "BACKUP_ID", value: backup.id },
                { name: "IMPORT_ACTOR", value: input.actorEmail },
                { name: "IMPORT_FINISH_URL", value: `${appUrl}/api/backups/production/finish` },
              ],
            },
          ],
        },
      },
    });
    return { ok: true, execution: res.data.metadata?.name ?? null };
  } catch (err) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    return { ok: false, error: status === 403 || status === 401 ? "permission_denied" : "unavailable" };
  }
}

/* ------------------------------------------------------------------ *
 * The finish step, called by the import job once the restore is done
 * ------------------------------------------------------------------ */

/** QA's users with access, as the job read them before the restore. */
export const userSnapshotSchema = z.object({
  id: z.string().min(1),
  email: z.string().min(1),
  name: z.string().nullable(),
  image: z.string().nullable(),
  eventRole: z.string(),
  trainingRole: z.string().nullable(),
  evalsRole: z.string().nullable(),
  // Optional, so a snapshot taken before Iris existed still restores.
  irisRole: z.string().nullable().default(null),
  isPlatformAdmin: z.boolean(),
  calendarScope: z.string(),
  accounts: z.array(
    z.object({
      type: z.string(),
      provider: z.string(),
      providerAccountId: z.string(),
    }),
  ),
});

export type UserSnapshot = z.infer<typeof userSnapshotSchema>;

export const finishSchema = z.object({
  backupId: z.string().regex(/^\d+$/),
  actor: z.string(),
  snapshot: z.array(userSnapshotSchema),
});

/**
 * Production's credentials, none of which QA should hold. Saved Harness tokens
 * and secrets are sealed with production's key, so QA could not open them
 * anyway, but they are production's to keep. Attendee passwords are for live
 * Workspace accounts that QA shares.
 */
const STRIP_CREDENTIALS = [
  `delete from sessions`,
  `delete from "verificationToken"`,
  `delete from user_invites`,
  `delete from api_tokens`,
  `delete from harness_deployed_secrets`,
  `delete from harness_tokens`,
  `delete from slack_installation`,
  `delete from harness_org_secrets`,
  `delete from harness_template_sources`,
  `update accounts
      set refresh_token = null, access_token = null, id_token = null,
          expires_at = null, session_state = null`,
];

/** Nobody has access until the snapshot gives it back. */
const REVOKE_ACCESS = `update users
    set site_role = 'none', training_role = null, evals_role = null,
        iris_role = null, is_platform_admin = false, calendar_scope = 'own'`;

export type FinishResult = {
  migrations: string[];
  attendeePasswordsCleared: number;
  usersRestored: number;
  usersAdded: number;
};

/**
 * Bring an imported database up to this deployment's schema and make it QA's.
 * A local import (`scripts/import-production.ts`) calls it too, with its own
 * connection string, on the copy before it replaces the local database.
 *
 * A fresh client rather than the app's pool: the restore closed every
 * connection the pool had. Migrations first, because production's schema can
 * be behind QA's code. Then one transaction, so a failure leaves the database
 * as the job's quarantine left it — stamped and inert — rather than half
 * cleaned.
 */
export async function finishProductionImport(
  input: { snapshot: UserSnapshot[] },
  options: { migrationsDir?: string; connectionString?: string } = {},
): Promise<FinishResult> {
  const dir = options.migrationsDir ?? path.join(process.cwd(), "drizzle");
  const files = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()
    : [];
  if (files.length === 0) throw new Error(`no migrations found in ${dir}`);

  const client = new pg.Client({
    connectionString: options.connectionString ?? process.env.DATABASE_URL,
  });
  await client.connect();
  try {
    // Each file is idempotent and is its own transaction.
    for (const file of files) {
      await client.query(fs.readFileSync(path.join(dir, file), "utf8"));
    }

    const environment = deploymentEnvironment();
    await client.query("begin");
    try {
      for (const statement of STRIP_CREDENTIALS) await client.query(statement);

      const cleared = await client.query(
        `update workshop_accounts set temp_password = ''
          where run_id in (select id from workshop_runs
                            where environment is not null and environment <> $1)`,
        [environment],
      );

      await client.query(REVOKE_ACCESS);

      let usersRestored = 0;
      let usersAdded = 0;
      for (const user of input.snapshot) {
        const roles = [
          user.eventRole,
          user.trainingRole,
          user.evalsRole,
          user.irisRole,
          user.isPlatformAdmin,
          user.calendarScope,
        ];
        const existing = await client.query<{ id: string }>(
          `update users
              set site_role = $2::site_role, training_role = $3::training_role,
                  evals_role = $4::evals_role, iris_role = $5::iris_role,
                  is_platform_admin = $6, calendar_scope = $7::calendar_scope
            where lower(email) = lower($1)
            returning id`,
          [user.email, ...roles],
        );

        let userId = existing.rows[0]?.id;
        if (userId) {
          usersRestored++;
        } else {
          // Keep QA's id when production has not used it for somebody else.
          const taken = await client.query(`select 1 from users where id = $1`, [user.id]);
          userId = taken.rowCount ? crypto.randomUUID() : user.id;
          await client.query(
            `insert into users (id, email, name, image, site_role, training_role,
                                evals_role, iris_role, is_platform_admin, calendar_scope)
             values ($1, $2, $3, $4, $5::site_role, $6::training_role,
                     $7::evals_role, $8::iris_role, $9, $10::calendar_scope)`,
            [userId, user.email, user.name, user.image, ...roles],
          );
          usersAdded++;
        }

        // Link their Google sign-in to this row, so it does not land on
        // production's row for the same account or fail as unlinked.
        for (const account of user.accounts) {
          await client.query(
            `insert into accounts ("userId", type, provider, "providerAccountId")
             values ($1, $2, $3, $4)
             on conflict (provider, "providerAccountId")
               do update set "userId" = excluded."userId"`,
            [userId, account.type, account.provider, account.providerAccountId],
          );
        }
      }

      await client.query("commit");
      return {
        migrations: files,
        attendeePasswordsCleared: cleared.rowCount ?? 0,
        usersRestored,
        usersAdded,
      };
    } catch (err) {
      await client.query("rollback").catch(() => {});
      throw err;
    }
  } finally {
    await client.end().catch(() => {});
  }
}
