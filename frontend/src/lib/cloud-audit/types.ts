/** The shapes every cloud audit returns. */

import { CLOUDS, type Cloud, type EventMode, type RunStatus } from "@/db/schema";

export type AuditTarget = Cloud | "harness";

export const AUDIT_TARGETS: AuditTarget[] = [...CLOUDS, "harness"];

export type ResourceOwner = {
  runId: string;
  name: string;
  status: RunStatus;
  mode: EventMode;
  attendee?: string;
};

export type Classification = "untracked" | "infra" | "tracked" | "unmanaged";

export const CLASSIFICATIONS: Classification[] = [
  "untracked",
  "infra",
  "tracked",
  "unmanaged",
];

export type AuditedResource = {
  id: string;
  name: string | null;
  url: string | null;
  state: { label: string; ok: boolean } | null;
  classification: Classification;
  owner: ResourceOwner | null;
};

export type MissingResource = { id: string } & ResourceOwner;

export type CloudAudit = {
  target: AuditTarget;
  scope: { label: string; value: string; name: string | null; url: string | null };
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

export type CloudStatusReport = Record<AuditTarget, CloudAuditResult>;

const RANK: Record<Classification, number> = {
  untracked: 0,
  infra: 1,
  tracked: 2,
  unmanaged: 3,
};

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
