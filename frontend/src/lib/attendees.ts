import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { CLAIM_LIMITS, workshopAccounts, workshopRuns } from "@/db/schema";
import type { Cloud, RunStatus } from "@/db/schema";

/**
 * Where one cloud's environment lives, as something an attendee can open.
 *
 * One per cloud the event actually built — the Google Cloud project, the Azure
 * resource group, the AWS account's console sign-in — so the page can offer the
 * same "here is your environment" button whichever clouds were picked. The
 * cloud is carried rather than a label: what the button should say is the
 * page's business, and differs between the one shared link a workshop shows
 * and the per-competitor link a challenge puts on each row.
 */
export type CloudLink = {
  cloud: Cloud;
  url: string;
};

/**
 * The attendee-facing view of an event.
 *
 * This is the one place in the app that serves data to people who are not
 * signed in, so it is deliberately narrow: the event's name and kind, the
 * account rows, and — the one deliberate exception — a link per cloud into the
 * environment(s) attendees were granted. Those links are not secrets: they
 * carry a project id, a resource group path, an AWS account number, and
 * everyone here has editor/Contributor on those environments and sees all of it
 * the moment they sign in. Nothing about the organizer, the org unit, the rest
 * of the Terraform outputs, or the build log crosses this boundary.
 */
export type AttendeeAccount = {
  id: number;
  email: string;
  tempPassword: string;
  /**
   * Entra Temporary Access Pass — what this attendee signs into the Azure
   * portal with, since Microsoft enforces MFA there and a password alone is no
   * longer accepted. Null when the run has no Azure environment, or when the
   * tenant would not issue one.
   */
  azureAccessPass: string | null;
  /** When that pass stops working, so the page can say if it already has. */
  azureAccessPassExpiresAt: Date | null;
  claimedName: string | null;
  claimedFrom: string | null;
  claimedVacation: string | null;
  claimedAt: Date | null;
  /**
   * This competitor's own environments, on a challenge — their GCP project,
   * their Azure resource group, their AWS account. Empty on a workshop, which
   * shares one environment per cloud and carries the links on the view instead.
   */
  links: CloudLink[];
};

export type AttendeeView = {
  name: string;
  mode: "workshop" | "challenge";
  status: RunStatus;
  /**
   * The workshop's shared environment, one link per cloud it provisioned (and
   * the shared testing project, for an event that picked no cloud at all —
   * that project is still where its attendees were given access). Empty on a
   * challenge, where every competitor has their own and the links sit on the
   * rows.
   */
  links: CloudLink[];
  accounts: AttendeeAccount[];
};

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The Terraform outputs this view reads, across every root that can run.
 *
 * The singular keys are a workshop's one shared environment per cloud; the maps
 * are a challenge's per-competitor ones, keyed by the address each was granted
 * to. Both the identifier and a ready-made console URL are read where the root
 * emits both, because older runs were provisioned before the URL outputs
 * existed and the identifier is enough to rebuild the link from.
 */
type RunOutputs = {
  gcp_project_id?: unknown;
  gcp_console_url?: unknown;
  /** The shared long-lived project, granted to a run that picked no cloud. */
  sandbox_project_id?: unknown;
  sandbox_console_url?: unknown;
  azure_portal_url?: unknown;
  aws_account_id?: unknown;
  aws_console_url?: unknown;
  gcp_projects?: unknown;
  gcp_console_urls?: unknown;
  azure_portal_urls?: unknown;
  aws_accounts?: unknown;
};

/** An output value, if it is a non-empty string. */
function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** An output map of address -> value, if it is one. */
function map(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** A project's console home — what "the project" means to someone opening it. */
function gcpConsoleUrl(projectId: string): string {
  return `https://console.cloud.google.com/home/dashboard?project=${encodeURIComponent(
    projectId,
  )}`;
}

/** The member account's own sign-in page, which is where its console lives. */
function awsConsoleUrl(accountId: string): string {
  return `https://${encodeURIComponent(accountId)}.signin.aws.amazon.com/console`;
}

/** Drop the clouds this run did not build, keeping CLOUDS' order. */
function linksOf(
  parts: Array<{ cloud: Cloud; url: string | null }>,
): CloudLink[] {
  return parts.flatMap(({ cloud, url }) => (url ? [{ cloud, url }] : []));
}

/** The one environment per cloud a workshop shares with the whole room. */
function sharedLinks(
  outputs: RunOutputs,
  gcpProjectId: string | null,
): CloudLink[] {
  const project = str(outputs.gcp_project_id) ?? gcpProjectId;
  const sandbox = str(outputs.sandbox_project_id);
  const awsAccount = str(outputs.aws_account_id);

  return linksOf([
    {
      cloud: "aws",
      url: str(outputs.aws_console_url) ?? (awsAccount && awsConsoleUrl(awsAccount)),
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

/** The environments a single competitor owns on a challenge. */
function competitorLinks(outputs: RunOutputs, email: string): CloudLink[] {
  const project = str(map(outputs.gcp_projects)[email]);
  const awsAccount = str(map(outputs.aws_accounts)[email]);

  return linksOf([
    { cloud: "aws", url: awsAccount && awsConsoleUrl(awsAccount) },
    { cloud: "azure", url: str(map(outputs.azure_portal_urls)[email]) },
    {
      cloud: "gcp",
      url:
        str(map(outputs.gcp_console_urls)[email]) ??
        (project && gcpConsoleUrl(project)),
    },
  ]);
}

/**
 * Load an event for its attendee page. Returns null for an unknown id, which
 * the page turns into a 404 — the same answer a real-but-finished event gives
 * once it has been reaped, so the link never reveals which it was.
 */
export async function getAttendeeView(
  runId: string,
): Promise<AttendeeView | null> {
  // The id comes straight off the URL. Postgres rejects a malformed uuid with
  // an error rather than an empty result, so anything that isn't one is a miss.
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

  // A challenge builds one environment per competitor and a workshop one for
  // the room, so exactly one of these two ever has anything in it — the roots
  // a challenge runs emit only the keyed maps, and the workshop roots only the
  // single values.
  const shared = sharedLinks(outputs, run.gcpProjectId);

  const accounts: AttendeeAccount[] = rows.map((a) => ({
    ...a,
    links: competitorLinks(outputs, a.email),
  }));

  return {
    name: run.name,
    mode: run.mode,
    status: run.status,
    links: shared,
    accounts,
  };
}

export type SaveFieldsInput = {
  name: string;
  from: string;
  vacation: string;
};

export type SaveFieldsError = "not_found" | "invalid";

/**
 * Save an account row's shared answers, as the room types them.
 *
 * There is no lock: the row is a communal scratchpad, not a claim to win. Any
 * visitor may edit any field of any row, the last write wins, and everyone sees
 * it on their next poll — two people typing into the same row is a harmless
 * collision the workshop laughs off, not an error to guard against. The write
 * is a plain update; the run id is in the predicate so a guessed account id
 * from another event still cannot be written through this event's link.
 *
 * `claimedAt` is kept only as the "row has a name" marker the room's counter
 * reads: stamped the first time a name is entered, kept afterwards, cleared if
 * the name is removed again.
 */
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

  // No row updated means the id is not this event's — a guessed or stale id.
  return saved ? { ok: true } : { ok: false, error: "not_found" };
}
