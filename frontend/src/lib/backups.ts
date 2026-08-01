import "server-only";

import { and, gte, inArray } from "drizzle-orm";
import { GoogleAuth } from "google-auth-library";
import { db } from "@/db";
import { workshopRuns } from "@/db/schema";

/**
 * The Cloud SQL backups behind the administrators' backups page.
 *
 * Everything here talks to the Cloud SQL Admin API as the app service account,
 * which holds `roles/cloudsql.editor` for exactly this. That is the broadest
 * permission the web app has, so two rules apply to every write below: the
 * caller is an administrator (checked in the route), and the instance name is
 * typed back by hand (checked here, again, in `restoreBackup`).
 *
 * Daily backups themselves are not created here — they are Cloud SQL's own
 * schedule, configured in `infra/admin/database.tf`. This module only reads
 * that history, adds an on-demand backup, and restores from one.
 */

const API = "https://sqladmin.googleapis.com/sql/v1beta4";

/** Where this deployment's database lives. Both are set by Terraform. */
export function backupTarget(): { project: string; instance: string } | null {
  const project = process.env.GCP_ADMIN_PROJECT_ID;
  const instance = process.env.CLOUD_SQL_INSTANCE;
  if (!project || !instance) return null;
  return { project, instance };
}

let auth: GoogleAuth | null = null;

async function api<T>(
  path: string,
  init?: { method?: "GET" | "POST"; data?: unknown },
): Promise<T> {
  auth ??= new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });

  const client = await auth.getClient();
  const res = await client.request<T>({
    url: `${API}${path}`,
    method: init?.method ?? "GET",
    ...(init?.data ? { data: init.data } : {}),
  });
  return res.data;
}

/**
 * One row of the history. Mirrors the fields of a Cloud SQL `BackupRun` that
 * are worth showing; the API returns a good deal more that is not.
 */
export type BackupRun = {
  id: string;
  /** AUTOMATED — the daily schedule; ON_DEMAND — someone pressed the button. */
  type: "AUTOMATED" | "ON_DEMAND" | string;
  /** SUCCESSFUL, RUNNING, FAILED, … Only a SUCCESSFUL one can be restored. */
  status: string;
  /** When the backup started; this is the point in time it restores you to. */
  startTime: string | null;
  endTime: string | null;
  location: string | null;
  description: string | null;
  error: string | null;
};

type BackupRunsResponse = {
  items?: {
    id?: string;
    type?: string;
    status?: string;
    startTime?: string;
    endTime?: string;
    location?: string;
    description?: string;
    error?: { message?: string };
  }[];
};

export type BackupsUnavailable =
  | "not_configured"
  | "permission_denied"
  | "unavailable";

/** Turn a failed API call into something the page can explain to a human. */
function classify(err: unknown): BackupsUnavailable {
  const status = (err as { response?: { status?: number } })?.response?.status;
  if (status === 403 || status === 401) return "permission_denied";
  return "unavailable";
}

/**
 * The instance's backup history, newest first.
 *
 * Cloud SQL returns these newest-first already; the sort is belt and braces so
 * the page's "most recent backup" is not at the mercy of that staying true.
 */
export async function listBackups(): Promise<
  { ok: true; backups: BackupRun[] } | { ok: false; error: BackupsUnavailable }
> {
  const target = backupTarget();
  if (!target) return { ok: false, error: "not_configured" };

  try {
    const data = await api<BackupRunsResponse>(
      `/projects/${target.project}/instances/${target.instance}/backupRuns?maxResults=50`,
    );

    const backups = (data.items ?? [])
      .filter((item): item is { id: string } & typeof item => Boolean(item.id))
      .map((item) => ({
        id: item.id,
        type: item.type ?? "UNKNOWN",
        status: item.status ?? "UNKNOWN",
        startTime: item.startTime ?? null,
        endTime: item.endTime ?? null,
        location: item.location ?? null,
        description: item.description ?? null,
        error: item.error?.message ?? null,
      }))
      .sort((a, b) => (b.startTime ?? "").localeCompare(a.startTime ?? ""));

    return { ok: true, backups };
  } catch (err) {
    return { ok: false, error: classify(err) };
  }
}

/**
 * Take a backup now.
 *
 * Its real job is to be the thing you press *before* a restore. Rolling the
 * instance back to 03:00 throws away everything written since; an on-demand
 * backup taken a minute earlier is the only way back from that decision.
 */
export async function createBackup(
  description: string,
): Promise<{ ok: true } | { ok: false; error: BackupsUnavailable }> {
  const target = backupTarget();
  if (!target) return { ok: false, error: "not_configured" };

  try {
    await api(
      `/projects/${target.project}/instances/${target.instance}/backupRuns`,
      { method: "POST", data: { description: description.slice(0, 255) } },
    );
    return { ok: true };
  } catch (err) {
    return { ok: false, error: classify(err) };
  }
}

/**
 * Statuses where a run still owns cloud resources somebody has to pay for:
 * a GCP project, a Workspace OU full of accounts, a Harness org.
 */
const HOLDS_RESOURCES = [
  "provisioning",
  "applying",
  "ready",
  "destroying",
] as const;

export type StrandedRun = {
  id: string;
  name: string;
  status: string;
  createdAt: Date;
};

/**
 * Events provisioned since a backup was taken.
 *
 * This is the specific, expensive consequence of restoring in place, and the
 * reason the confirmation dialog is not a generic "are you sure". A restore
 * rolls `workshop_runs` back too. Any run created after the backup vanishes
 * from the database while its GCP project, its Workspace accounts, and its
 * Harness organization keep existing — and the reaper only tears down what it
 * can find a row for. Those resources would then never be cleaned up, and the
 * attendee accounts would stay live.
 *
 * Surfaced before the restore so the decision is made with the list in view,
 * and so there is something to write down and clean up by hand afterwards.
 */
export async function runsStrandedBy(backupTime: Date): Promise<StrandedRun[]> {
  return db
    .select({
      id: workshopRuns.id,
      name: workshopRuns.name,
      status: workshopRuns.status,
      createdAt: workshopRuns.createdAt,
    })
    .from(workshopRuns)
    .where(
      and(
        gte(workshopRuns.createdAt, backupTime),
        inArray(workshopRuns.status, [...HOLDS_RESOURCES]),
      ),
    )
    .orderBy(workshopRuns.createdAt);
}

export type RestoreError =
  | BackupsUnavailable
  | "not_found"
  | "not_restorable"
  | "confirmation_mismatch";

/**
 * Restore the instance from a backup, in place.
 *
 * This overwrites the whole instance — every database and every table, not the
 * lab tables the page was probably opened for. The API call returns as soon as
 * the operation is queued; the instance then goes offline for the length of the
 * restore, so the response this produces is the last thing the caller will get
 * from the app for a few minutes.
 *
 * `confirmation` must be the instance's own name, typed by the administrator.
 * It is re-checked here rather than trusted from the dialog, because the dialog
 * is not what authorises this.
 */
export async function restoreBackup(
  backupId: string,
  confirmation: string,
): Promise<{ ok: true } | { ok: false; error: RestoreError }> {
  const target = backupTarget();
  if (!target) return { ok: false, error: "not_configured" };

  if (confirmation.trim() !== target.instance) {
    return { ok: false, error: "confirmation_mismatch" };
  }

  // Restoring from a backup that did not finish would take the instance down
  // to reach a state that was never consistent.
  const listed = await listBackups();
  if (!listed.ok) return { ok: false, error: listed.error };

  const backup = listed.backups.find((b) => b.id === backupId);
  if (!backup) return { ok: false, error: "not_found" };
  if (backup.status !== "SUCCESSFUL") {
    return { ok: false, error: "not_restorable" };
  }

  try {
    await api(
      `/projects/${target.project}/instances/${target.instance}/restoreBackup`,
      {
        method: "POST",
        data: {
          restoreBackupContext: {
            backupRunId: backupId,
            instanceId: target.instance,
            project: target.project,
          },
        },
      },
    );
    return { ok: true };
  } catch (err) {
    return { ok: false, error: classify(err) };
  }
}

/**
 * Write an audit line to stdout, which on Cloud Run is Cloud Logging.
 *
 * Deliberately not a database table. A restore rolls the database back, so an
 * audit row written just before one would be erased by the very event it
 * records — the log has to outlive the thing it is logging.
 */
export function auditBackupAction(entry: {
  action: "restore" | "backup";
  actorId: string;
  actorEmail: string;
  backupId?: string;
  backupTime?: string | null;
  strandedRunIds?: string[];
}): void {
  console.log(
    JSON.stringify({
      severity: "NOTICE",
      component: "backups",
      at: new Date().toISOString(),
      ...entry,
    }),
  );
}
