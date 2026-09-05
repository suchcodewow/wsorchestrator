import "server-only";

import { db } from "@/db";
import type { AuditTarget, ResourceOwner } from "./types";

/**
 * The database half of the audit: for each audited platform, resource id -> the
 * run that created it.
 *
 * One pass over `workshop_runs` builds every map, because every audit needs one
 * and the rows are the same rows. A run records its boundaries in two shapes, and
 * both are read here:
 *
 *   * a single id, for a workshop's one shared environment — the `gcp_project_id`
 *     column, or `azure_resource_group` / `aws_account_id` / `harness_org` in
 *     `outputs`;
 *   * an address -> id map, for a challenge's per-competitor environments —
 *     `gcp_projects`, `azure_resource_groups`, `aws_accounts`. Harness has no
 *     such shape: a challenge still gets one organization, with a project per
 *     competitor inside it, and a project is not an isolation boundary this page
 *     audits.
 *
 * Destroyed runs are deliberately kept. Teardown leaves the row and its outputs
 * in place, so a closed AWS account or a deleted project stays attributed to the
 * run that made it rather than resurfacing as an orphan; that is also what makes
 * the "referenced by a run, but the platform no longer lists it" reconciliation
 * on each audit meaningful.
 */

export type OwnerMaps = {
  /** Keys are normalized per target by `normalizeId` — always look up through it. */
  byResource: Record<AuditTarget, Map<string, ResourceOwner>>;
  /**
   * The `run_id` tag value -> the run, for resources the orchestrator created
   * without recording their id.
   *
   * Every cloud gets this tag stamped on it (`runner/src/workspace.ts`), but it
   * only earns its keep on Azure: AKS builds a second resource group per cluster
   * for the nodes, disks and load balancers, and inherits the cluster's tags onto
   * it. Nothing records that group's name, so the tag is the only thing tying it
   * back to a run. It identifies the run and not the individual resource, so it
   * is strictly a fallback — a challenge stamps all of a competitor's resources
   * with the same value, and only `byResource` knows which competitor.
   */
  byRunTag: Map<string, ResourceOwner>;
};

/** How `runner/src/workspace.ts` shortens a run id for the `run_id` tag. */
const runTag = (runId: string) => runId.replace(/-/g, "").slice(0, 12);

/**
 * Match ids the way the platform does. Azure treats resource-group names
 * case-insensitively and echoes back whatever case created them, so an RG the
 * runner named in lowercase must still match if the API answers differently.
 * GCP project ids, AWS account ids and Harness identifiers are exact.
 */
export function normalizeId(target: AuditTarget, id: string): string {
  return target === "azure" ? id.toLowerCase() : id;
}

const str = (v: unknown): string | null =>
  typeof v === "string" && v.length > 0 ? v : null;

/** An `outputs` value that should be an address -> id map, or nothing. */
function entries(v: unknown): Array<[string, string]> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return [];
  return Object.entries(v as Record<string, unknown>).flatMap(([k, id]) => {
    const s = str(id);
    return s ? [[k, s] as [string, string]] : [];
  });
}

/** The `outputs` keys this module reads. Everything else in the blob is ignored. */
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

    // Workshops: one shared boundary per cloud. The GCP one has its own column
    // (it predates `outputs`); Azure and AWS live in the outputs blob.
    set("gcp", r.gcpProjectId, base);
    set("azure", str(out.azure_resource_group), base);
    set("aws", str(out.aws_account_id), base);
    // Every run gets one, whatever clouds it selected — including a sandbox run,
    // which is Harness and nothing else.
    set("harness", str(out.harness_org), base);

    // Challenges: one boundary per competitor, keyed by their address.
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

/**
 * Ids a run still claims that the platform didn't list — usually a boundary
 * already deleted. Nothing is being charged for it any more, so not the page's
 * headline concern, but surfaced so the two views can be reconciled.
 */
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
