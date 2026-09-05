import { CLOUDS, type Cloud, type EventMode, type RunStatus } from "@/db/schema";

/**
 * The vocabulary the Cloud Status page is written in — one shape every audited
 * platform is flattened into, so the page renders one table four times instead
 * of four tables.
 *
 * Every one of them has the same story to tell: there is a *scope* the
 * deployment provisions inside (a billing account, an AWS organization, an Azure
 * subscription, a Harness account), that scope contains *isolation boundaries* (a
 * project, a member account, a resource group, a Harness organization), and each
 * of those either belongs to a run in the database or it doesn't. What differs is
 * only the nouns, so the nouns travel with the data as labels rather than being
 * branched on in the view.
 *
 * No `server-only` here on purpose: the client component imports these types,
 * and a type-only import of a `server-only` module is fragile in a way that a
 * plain types module isn't.
 */

/**
 * What the page audits: the three clouds the workshops are billed for, and the
 * Harness account they are run out of.
 *
 * Harness sits alongside the clouds rather than inside `Cloud` because it is not
 * one — a run selects which clouds to build, but every run gets a Harness
 * organization, and nothing here is about spend. What it shares with the clouds
 * is the only thing this page cares about: things that outlive the run that made
 * them.
 */
export type AuditTarget = Cloud | "harness";

/** Tab order on the page. Harness last, after the clouds it wires together. */
export const AUDIT_TARGETS: AuditTarget[] = [...CLOUDS, "harness"];

/** The run a resource belongs to — the "who owns this" column. */
export type ResourceOwner = {
  runId: string;
  name: string;
  status: RunStatus;
  mode: EventMode;
  /** For a challenge, the competitor whose resource this is. */
  attendee?: string;
};

/**
 * How a resource matched the database.
 *
 * `unmanaged` is the bucket that keeps the alarm honest in a shared scope: an
 * Azure subscription is full of resource groups nobody here created (Azure's own
 * `NetworkWatcherRG`, a colleague's experiment), and a Harness account holds the
 * organizations the team actually works in. Calling those orphans would bury the
 * one that is one. Only resources the orchestrator stamped — or that live in a
 * scope it owns outright — can be `untracked`.
 */
export type Classification = "untracked" | "infra" | "tracked" | "unmanaged";

export const CLASSIFICATIONS: Classification[] = [
  "untracked",
  "infra",
  "tracked",
  "unmanaged",
];

/**
 * One isolation boundary: a GCP project, an AWS account, an Azure RG, a Harness
 * organization.
 */
export type AuditedResource = {
  /** The id the run records and the table keys on. */
  id: string;
  /** Whatever the cloud's `columns.name` promises; null when unreadable. */
  name: string | null;
  /** Console/portal deep link, when the cloud gives one. */
  url: string | null;
  /**
   * The cloud's own word for the resource's health — billing enabled, account
   * ACTIVE, provisioning Succeeded. `ok: false` renders it as a warning.
   */
  state: { label: string; ok: boolean } | null;
  classification: Classification;
  owner: ResourceOwner | null;
};

/** A resource a run still references that the platform no longer lists. */
export type MissingResource = { id: string } & ResourceOwner;

export type CloudAudit = {
  target: AuditTarget;
  /**
   * What everything was listed from — the billing account, organization,
   * subscription, or Harness account. `value` is the id; `name` is its display
   * name when the platform will tell us.
   */
  scope: { label: string; value: string; name: string | null; url: string | null };
  /** Column headers, so the shared table needs no per-target branches. */
  columns: { id: string; name: string; state: string };
  resources: AuditedResource[];
  missing: MissingResource[];
  counts: Record<Classification | "total", number>;
};

export type AuditUnavailable =
  | "not_configured"
  | "permission_denied"
  | "unavailable";

export type CloudAuditResult =
  | { ok: true; audit: CloudAudit }
  | { ok: false; error: AuditUnavailable };

/** Every audited platform, each answering independently. */
export type CloudStatusReport = Record<AuditTarget, CloudAuditResult>;

/** Untracked first (what an admin is here to find), then the rest. */
const RANK: Record<Classification, number> = {
  untracked: 0,
  infra: 1,
  tracked: 2,
  unmanaged: 3,
};

/**
 * Order and tally one target's resources. Shared so the audits can't drift into
 * presenting the same thing differently.
 */
export function summarize(resources: AuditedResource[]): {
  resources: AuditedResource[];
  counts: Record<Classification | "total", number>;
} {
  const sorted = [...resources].sort(
    (a, b) =>
      RANK[a.classification] - RANK[b.classification] || a.id.localeCompare(b.id),
  );
  const counts = {
    total: sorted.length,
    untracked: 0,
    infra: 0,
    tracked: 0,
    unmanaged: 0,
  };
  for (const r of sorted) counts[r.classification] += 1;
  return { resources: sorted, counts };
}
