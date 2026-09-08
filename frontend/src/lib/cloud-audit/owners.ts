/** Matches cloud resources to the runs that claim them. */

import "server-only";

import { db } from "@/db";
import type { AuditTarget, ResourceOwner } from "./types";

export type OwnerMaps = {
  byResource: Record<AuditTarget, Map<string, ResourceOwner>>;
  byRunTag: Map<string, ResourceOwner>;
};

const runTag = (runId: string) => runId.replace(/-/g, "").slice(0, 12);

export function normalizeId(target: AuditTarget, id: string): string {
  return target === "azure" ? id.toLowerCase() : id;
}

const str = (v: unknown): string | null =>
  typeof v === "string" && v.length > 0 ? v : null;

function entries(v: unknown): Array<[string, string]> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return [];
  return Object.entries(v as Record<string, unknown>).flatMap(([k, id]) => {
    const s = str(id);
    return s ? [[k, s] as [string, string]] : [];
  });
}

type RunOutputs = {
  gcp_projects?: unknown;
  azure_resource_group?: unknown;
  azure_resource_groups?: unknown;
  aws_account_id?: unknown;
  aws_accounts?: unknown;
  harness_org?: unknown;
};

export async function resourceOwners(): Promise<OwnerMaps> {
  const rows = await db.query.workshopRuns.findMany({
    columns: {
      id: true,
      name: true,
      status: true,
      mode: true,
      gcpProjectId: true,
      outputs: true,
    },
  });

  const maps: OwnerMaps = {
    byResource: {
      gcp: new Map(),
      aws: new Map(),
      azure: new Map(),
      harness: new Map(),
    },
    byRunTag: new Map(),
  };

  const set = (target: AuditTarget, id: string | null, owner: ResourceOwner) => {
    if (id) maps.byResource[target].set(normalizeId(target, id), owner);
  };

  for (const r of rows) {
    const base: ResourceOwner = {
      runId: r.id,
      name: r.name,
      status: r.status,
      mode: r.mode,
    };
    const out = (r.outputs ?? {}) as RunOutputs;

    maps.byRunTag.set(runTag(r.id), base);

    set("gcp", r.gcpProjectId, base);
    set("azure", str(out.azure_resource_group), base);
    set("aws", str(out.aws_account_id), base);
    set("harness", str(out.harness_org), base);

    const perUser: Array<[AuditTarget, unknown]> = [
      ["gcp", out.gcp_projects],
      ["azure", out.azure_resource_groups],
      ["aws", out.aws_accounts],
    ];
    for (const [target, value] of perUser) {
      for (const [attendee, id] of entries(value)) {
        set(target, id, { ...base, attendee });
      }
    }
  }

  return maps;
}

export function missingFromCloud(
  owners: Map<string, ResourceOwner>,
  present: Iterable<string>,
  ignore: Set<string> = new Set(),
): Array<{ id: string } & ResourceOwner> {
  const seen = new Set(present);
  return [...owners.entries()]
    .filter(([id]) => !seen.has(id) && !ignore.has(id))
    .map(([id, owner]) => ({ id, ...owner }));
}
