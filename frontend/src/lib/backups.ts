/** Cloud SQL backups: listing, taking and restoring them. */

import "server-only";

import { and, gte, inArray } from "drizzle-orm";
import { GoogleAuth } from "google-auth-library";
import { db } from "@/db";
import { workshopRuns } from "@/db/schema";

const API = "https://sqladmin.googleapis.com/sql/v1beta4";

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

export type BackupRun = {
  id: string;
  type: "AUTOMATED" | "ON_DEMAND" | string;
  status: string;
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

function classify(err: unknown): BackupsUnavailable {
  const status = (err as { response?: { status?: number } })?.response?.status;
  if (status === 403 || status === 401) return "permission_denied";
  return "unavailable";
}

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

export async function restoreBackup(
  backupId: string,
  confirmation: string,
): Promise<{ ok: true } | { ok: false; error: RestoreError }> {
  const target = backupTarget();
  if (!target) return { ok: false, error: "not_configured" };

  if (confirmation.trim() !== target.instance) {
    return { ok: false, error: "confirmation_mismatch" };
  }

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
