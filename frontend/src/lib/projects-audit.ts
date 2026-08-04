import "server-only";

import { GoogleAuth } from "google-auth-library";
import { db } from "@/db";
import type { EventMode, RunStatus } from "@/db/schema";

/**
 * The billing-account project audit behind the administrators' "Projects" page.
 *
 * It answers one question: is every project the workshop account is billed for
 * accounted for? It lists the billing account's projects (Cloud Billing API, as
 * the app service account — which holds `roles/billing.viewer` for exactly
 * this, see `infra/admin/iam.tf`) and matches each against the runs table.
 * Anything billed but unmatched — and not a known piece of control-plane infra
 * — is flagged as an orphan or an extraneous project someone stood up.
 *
 * Read-only throughout: `billing.viewer` cannot change billing or move
 * projects, and nothing here writes to the database.
 */

const BILLING_API = "https://cloudbilling.googleapis.com/v1";
const RESOURCE_MANAGER_API = "https://cloudresourcemanager.googleapis.com/v3";

/** The billing account this deployment provisions under. Set by Terraform. */
export function billingAccountId(): string | null {
  return process.env.GCP_BILLING_ACCOUNT_ID || null;
}

/**
 * Projects that are legitimately billed but never appear as a run: the durable
 * control plane and the shared sandbox. Kept out of the "untracked" bucket so
 * they don't read as orphans every time the page loads.
 */
function infraProjectIds(): Set<string> {
  const ids = new Set<string>();
  const admin = process.env.GCP_ADMIN_PROJECT_ID;
  const sandbox = process.env.GCP_SANDBOX_PROJECT_ID;
  if (admin) ids.add(admin);
  if (sandbox) ids.add(sandbox);
  return ids;
}

let auth: GoogleAuth | null = null;

async function gcpGet<T>(url: string): Promise<T> {
  auth ??= new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  const client = await auth.getClient();
  const res = await client.request<T>({ url });
  return res.data;
}

type ProjectBillingInfo = { projectId?: string; billingEnabled?: boolean };
type ProjectsResponse = {
  projectBillingInfo?: ProjectBillingInfo[];
  nextPageToken?: string;
};

export type BillingProject = { projectId: string; billingEnabled: boolean };

/** Every project associated with the billing account, following pagination. */
async function listBillingProjects(accountId: string): Promise<BillingProject[]> {
  const projects: BillingProject[] = [];
  let pageToken: string | undefined;
  do {
    const qs = new URLSearchParams({ pageSize: "200" });
    if (pageToken) qs.set("pageToken", pageToken);
    const data = await gcpGet<ProjectsResponse>(
      `${BILLING_API}/billingAccounts/${accountId}/projects?${qs}`,
    );
    for (const p of data.projectBillingInfo ?? []) {
      if (p.projectId) {
        projects.push({
          projectId: p.projectId,
          billingEnabled: Boolean(p.billingEnabled),
        });
      }
    }
    pageToken = data.nextPageToken || undefined;
  } while (pageToken);
  return projects;
}

type ProjectSearchResponse = {
  projects?: Array<{ projectId?: string; displayName?: string }>;
  nextPageToken?: string;
};

/**
 * projectId -> human display name, from Cloud Resource Manager.
 *
 * Best-effort: app-sa can only read names for projects it has
 * `resourcemanager.projects.get` on — `roles/browser` on the workshops folder
 * (see `infra/admin/iam.tf`) — so projects outside that scope, and this whole
 * call before the grant is applied, simply come back nameless rather than
 * failing the audit. `projects:search` returns everything the caller can see
 * in one paginated sweep, so it is one call regardless of project count.
 */
async function projectDisplayNames(): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  try {
    let pageToken: string | undefined;
    do {
      const qs = new URLSearchParams({ pageSize: "500" });
      if (pageToken) qs.set("pageToken", pageToken);
      const data = await gcpGet<ProjectSearchResponse>(
        `${RESOURCE_MANAGER_API}/projects:search?${qs}`,
      );
      for (const p of data.projects ?? []) {
        if (p.projectId && p.displayName) names.set(p.projectId, p.displayName);
      }
      pageToken = data.nextPageToken || undefined;
    } while (pageToken);
  } catch {
    // No resource-manager access (yet) — names are optional enrichment.
  }
  return names;
}

/** The run a project belongs to, for the "who owns this" column. */
export type ProjectOwner = {
  runId: string;
  name: string;
  status: RunStatus;
  mode: EventMode;
  /** For a challenge, the competitor whose project this is. */
  attendee?: string;
};

/**
 * Project id -> the run that created it, from both places a run records one:
 * `gcpProjectId` (a workshop's shared project) and the `gcp_projects` output
 * map (a challenge's per-competitor projects, keyed by address).
 */
async function knownProjects(): Promise<Map<string, ProjectOwner>> {
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

  const map = new Map<string, ProjectOwner>();
  for (const r of rows) {
    const base = { runId: r.id, name: r.name, status: r.status, mode: r.mode };
    if (r.gcpProjectId) map.set(r.gcpProjectId, base);

    const perUser = (r.outputs as { gcp_projects?: Record<string, string> } | null)
      ?.gcp_projects;
    if (perUser) {
      for (const [attendee, projectId] of Object.entries(perUser)) {
        if (projectId) map.set(projectId, { ...base, attendee });
      }
    }
  }
  return map;
}

export type ProjectClassification = "untracked" | "infra" | "tracked";

export type AuditedProject = BillingProject & {
  /** Human display name from Resource Manager; null when unreadable. */
  name: string | null;
  classification: ProjectClassification;
  owner: ProjectOwner | null;
};

export type ProjectAudit = {
  billingAccountId: string;
  projects: AuditedProject[];
  /**
   * Projects a run still references that the billing account no longer lists —
   * usually a run whose project was already deleted. Not billed, so not the
   * page's headline concern, but surfaced so the two views can be reconciled.
   */
  missingFromBilling: Array<{ projectId: string } & ProjectOwner>;
  counts: { total: number; untracked: number; infra: number; tracked: number };
};

export type AuditUnavailable =
  | "not_configured"
  | "permission_denied"
  | "unavailable";

function classify(err: unknown): AuditUnavailable {
  const status = (err as { response?: { status?: number } })?.response?.status;
  if (status === 403 || status === 401) return "permission_denied";
  return "unavailable";
}

/** Untracked first (what an admin is here to find), then infra, then tracked. */
const RANK: Record<ProjectClassification, number> = {
  untracked: 0,
  infra: 1,
  tracked: 2,
};

/**
 * List the billing account's projects and classify each against the database.
 * Returns a typed error rather than throwing, so the page can explain a missing
 * `billing.viewer` grant instead of 500-ing.
 */
export async function auditBillingProjects(): Promise<
  { ok: true; audit: ProjectAudit } | { ok: false; error: AuditUnavailable }
> {
  const accountId = billingAccountId();
  if (!accountId) return { ok: false, error: "not_configured" };

  let billing: BillingProject[];
  try {
    billing = await listBillingProjects(accountId);
  } catch (err) {
    return { ok: false, error: classify(err) };
  }

  // The DB match and the name lookup are independent — run them together.
  const [known, names] = await Promise.all([
    knownProjects(),
    projectDisplayNames(),
  ]);
  const infra = infraProjectIds();

  const projects: AuditedProject[] = billing
    .map((p) => {
      const owner = known.get(p.projectId) ?? null;
      const classification: ProjectClassification = owner
        ? "tracked"
        : infra.has(p.projectId)
          ? "infra"
          : "untracked";
      return { ...p, name: names.get(p.projectId) ?? null, classification, owner };
    })
    .sort(
      (a, b) =>
        RANK[a.classification] - RANK[b.classification] ||
        a.projectId.localeCompare(b.projectId),
    );

  const billingIds = new Set(billing.map((p) => p.projectId));
  const missingFromBilling = [...known.entries()]
    .filter(([projectId]) => !billingIds.has(projectId) && !infra.has(projectId))
    .map(([projectId, owner]) => ({ projectId, ...owner }));

  const counts = {
    total: projects.length,
    untracked: projects.filter((p) => p.classification === "untracked").length,
    infra: projects.filter((p) => p.classification === "infra").length,
    tracked: projects.filter((p) => p.classification === "tracked").length,
  };

  return {
    ok: true,
    audit: { billingAccountId: accountId, projects, missingFromBilling, counts },
  };
}
