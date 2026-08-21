import { recordResource, type Resource } from "./db.js";

/**
 * Turning a Terraform root's outputs into the items the run page lists.
 *
 * The outputs are the only description of what an apply built, but they are a
 * flat bag of provider-named keys — `gke_cluster_name`, `azure_resource_group`
 * — written for machines. This maps the ones worth showing onto named things
 * ("GKE cluster", with its location and a console link), and drops the rest:
 * passwords, service lists, and the per-competitor URL maps that only exist to
 * be looked up by address.
 *
 * `from` names the output holding the identifier. `detailFrom` is a second
 * output appended in parentheses (a cluster's location), `urlFrom` the console
 * link to hang off it. A `map` output is address -> identifier — a challenge's
 * per-competitor environments — and records as a single counted item rather
 * than one row per competitor.
 */
type OutputResource = Omit<Resource, "detail" | "url" | "done" | "total"> & {
  from: string;
  detailFrom?: string;
  urlFrom?: string;
  /** The output is a map keyed by attendee address, not a single value. */
  map?: boolean;
};

const OUTPUT_RESOURCES: OutputResource[] = [
  {
    from: "gcp_project_id",
    urlFrom: "gcp_console_url",
    kind: "gcp_project",
    label: "GCP project",
  },
  {
    // The no-cloud path: the shared long-lived project, granted rather than
    // created. Worth listing precisely because it is not this run's own —
    // it says where the attendees actually ended up.
    from: "sandbox_project_id",
    urlFrom: "sandbox_console_url",
    kind: "gcp_project",
    label: "Shared GCP project",
  },
  {
    from: "gcp_projects",
    map: true,
    kind: "gcp_project",
    label: "GCP projects",
  },
  {
    from: "gke_cluster_name",
    detailFrom: "gke_cluster_location",
    kind: "gke_cluster",
    label: "GKE cluster",
  },
  {
    from: "azure_resource_group",
    urlFrom: "azure_portal_url",
    kind: "azure_resource_group",
    label: "Azure resource group",
  },
  {
    from: "azure_resource_groups",
    map: true,
    kind: "azure_resource_group",
    label: "Azure resource groups",
  },
  {
    from: "aks_cluster_name",
    detailFrom: "aks_cluster_location",
    kind: "aks_cluster",
    label: "AKS cluster",
  },
  {
    from: "aws_account_id",
    urlFrom: "aws_console_url",
    kind: "aws_account",
    label: "AWS account",
  },
  { from: "aws_accounts", map: true, kind: "aws_account", label: "AWS accounts" },
  { from: "eks_cluster_name", kind: "eks_cluster", label: "EKS cluster" },
];

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.length > 0 ? v : undefined;

/** How many entries a per-competitor output map has, if it is one. */
function mapSize(v: unknown): number | undefined {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return undefined;
  return Object.keys(v as Record<string, unknown>).length;
}

/**
 * Record every listable thing in one apply's outputs.
 *
 * Called per cloud as each apply returns, not once at the end, so a run
 * building three clouds shows the first one's cluster while the second is
 * still being applied.
 */
export async function recordOutputResources(
  runId: string,
  outputs: Record<string, unknown>,
): Promise<void> {
  for (const spec of OUTPUT_RESOURCES) {
    const value = outputs[spec.from];

    if (spec.map) {
      const count = mapSize(value);
      if (!count) continue;
      await recordResource(runId, {
        kind: spec.kind,
        key: spec.from,
        label: spec.label,
        detail: "one per competitor",
        done: count,
        total: count,
      });
      continue;
    }

    const detail = str(value);
    if (!detail) continue;
    const where = spec.detailFrom ? str(outputs[spec.detailFrom]) : undefined;
    await recordResource(runId, {
      kind: spec.kind,
      key: spec.from,
      label: spec.label,
      detail: where ? `${detail} (${where})` : detail,
      url: spec.urlFrom ? (str(outputs[spec.urlFrom]) ?? null) : null,
    });
  }
}
