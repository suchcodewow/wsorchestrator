/** Reads and writes an event's attendee page. */

import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { CLAIM_LIMITS, workshopAccounts, workshopRuns } from "@/db/schema";
import type { Cloud, RunStatus } from "@/db/schema";

export type CloudLink = {
  cloud: Cloud;
  url: string;
};

export type AttendeeAccount = {
  id: number;
  email: string;
  tempPassword: string;
  azureAccessPass: string | null;
  azureAccessPassExpiresAt: Date | null;
  awsPassword: string | null;
  claimedName: string | null;
  claimedFrom: string | null;
  claimedVacation: string | null;
  claimedAt: Date | null;
  links: CloudLink[];
  harnessProjectUrl: string | null;
};

export type AttendeeView = {
  name: string;
  mode: "workshop" | "challenge";
  status: RunStatus;
  links: CloudLink[];
  harnessOrgUrl: string | null;
  accounts: AttendeeAccount[];
};

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RunOutputs = {
  gcp_project_id?: unknown;
  gcp_console_url?: unknown;
  sandbox_project_id?: unknown;
  sandbox_console_url?: unknown;
  azure_portal_url?: unknown;
  aws_account_id?: unknown;
  aws_account_alias?: unknown;
  aws_console_url?: unknown;
  aws_region?: unknown;
  aws_attendee_passwords?: unknown;
  gcp_projects?: unknown;
  gcp_console_urls?: unknown;
  azure_portal_urls?: unknown;
  aws_accounts?: unknown;
  aws_account_aliases?: unknown;
  harness_org_url?: unknown;
  harness_project_urls?: unknown;
};

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function map(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function gcpConsoleUrl(projectId: string): string {
  return `https://console.cloud.google.com/home/dashboard?project=${encodeURIComponent(
    projectId,
  )}`;
}

const DEFAULT_AWS_REGION = "us-east-1";

const AWS_REGION = /^[a-z0-9-]+$/;

function awsRegion(outputs: RunOutputs): string {
  const region = str(outputs.aws_region);
  return region && AWS_REGION.test(region) ? region : DEFAULT_AWS_REGION;
}

function awsConsoleUrl(alias: string, region: string): string {
  return (
    `https://${encodeURIComponent(alias)}.signin.aws.amazon.com/console` +
    `?region=${region}`
  );
}

function linksOf(
  parts: Array<{ cloud: Cloud; url: string | null }>,
): CloudLink[] {
  return parts.flatMap(({ cloud, url }) => (url ? [{ cloud, url }] : []));
}

function sharedLinks(
  outputs: RunOutputs,
  gcpProjectId: string | null,
): CloudLink[] {
  const project = str(outputs.gcp_project_id) ?? gcpProjectId;
  const sandbox = str(outputs.sandbox_project_id);
  const awsAlias = str(outputs.aws_account_alias);

  return linksOf([
    {
      cloud: "aws",
      url:
        (awsAlias && awsConsoleUrl(awsAlias, awsRegion(outputs))) ??
        str(outputs.aws_console_url),
    },
    { cloud: "azure", url: str(outputs.azure_portal_url) },
    {
      cloud: "gcp",
      url:
        str(outputs.gcp_console_url) ??
        (project && gcpConsoleUrl(project)) ??
        str(outputs.sandbox_console_url) ??
        (sandbox && gcpConsoleUrl(sandbox)),
    },
  ]);
}

function competitorLinks(outputs: RunOutputs, email: string): CloudLink[] {
  const project = str(map(outputs.gcp_projects)[email]);
  const awsAlias = str(map(outputs.aws_account_aliases)[email]);

  return linksOf([
    {
      cloud: "aws",
      url: awsAlias && awsConsoleUrl(awsAlias, awsRegion(outputs)),
    },
    { cloud: "azure", url: str(map(outputs.azure_portal_urls)[email]) },
    {
      cloud: "gcp",
      url:
        str(map(outputs.gcp_console_urls)[email]) ??
        (project && gcpConsoleUrl(project)),
    },
  ]);
}

export async function getAttendeeView(
  runId: string,
): Promise<AttendeeView | null> {
  if (!UUID.test(runId)) return null;

  const run = await db.query.workshopRuns.findFirst({
    where: eq(workshopRuns.id, runId),
    columns: {
      name: true,
      mode: true,
      status: true,
      gcpProjectId: true,
      outputs: true,
    },
  });
  if (!run) return null;

  const rows = await db.query.workshopAccounts.findMany({
    where: eq(workshopAccounts.runId, runId),
    orderBy: workshopAccounts.id,
    columns: {
      id: true,
      email: true,
      tempPassword: true,
      azureAccessPass: true,
      azureAccessPassExpiresAt: true,
      claimedName: true,
      claimedFrom: true,
      claimedVacation: true,
      claimedAt: true,
    },
  });

  const outputs = (run.outputs ?? {}) as RunOutputs;

  const shared = sharedLinks(outputs, run.gcpProjectId);

  const harnessProjects = map(outputs.harness_project_urls);
  const awsPasswords = map(outputs.aws_attendee_passwords);

  const accounts: AttendeeAccount[] = rows.map((a) => ({
    ...a,
    links: competitorLinks(outputs, a.email),
    harnessProjectUrl: str(harnessProjects[a.email]),
    awsPassword: str(awsPasswords[a.email]),
  }));

  return {
    name: run.name,
    mode: run.mode,
    status: run.status,
    links: shared,
    harnessOrgUrl: str(outputs.harness_org_url),
    accounts,
  };
}

export type SaveFieldsInput = {
  name: string;
  from: string;
  vacation: string;
};

export type SaveFieldsError = "not_found" | "invalid";

export async function saveAttendeeFields(
  runId: string,
  accountId: number,
  input: SaveFieldsInput,
): Promise<{ ok: true } | { ok: false; error: SaveFieldsError }> {
  if (!UUID.test(runId)) return { ok: false, error: "not_found" };

  const name = input.name.trim();
  const from = input.from.trim();
  const vacation = input.vacation.trim();

  if (
    name.length > CLAIM_LIMITS.name ||
    from.length > CLAIM_LIMITS.from ||
    vacation.length > CLAIM_LIMITS.vacation
  ) {
    return { ok: false, error: "invalid" };
  }

  const [saved] = await db
    .update(workshopAccounts)
    .set({
      claimedName: name || null,
      claimedFrom: from || null,
      claimedVacation: vacation || null,
      claimedAt: sql`case when ${name} <> '' then coalesce(${workshopAccounts.claimedAt}, now()) else null end`,
    })
    .where(
      and(
        eq(workshopAccounts.id, accountId),
        eq(workshopAccounts.runId, runId),
      ),
    )
    .returning({ id: workshopAccounts.id });

  return saved ? { ok: true } : { ok: false, error: "not_found" };
}
