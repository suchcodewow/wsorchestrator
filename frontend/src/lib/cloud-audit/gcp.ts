import "server-only";

import { GoogleAuth } from "google-auth-library";
import { missingFromCloud, type OwnerMaps } from "./owners";
import {
  summarize,
  type AuditedResource,
  type AuditUnavailable,
  type CloudAuditResult,
} from "./types";

/**
 * The Google Cloud half of the Cloud Status page.
 *
 * It answers one question: is every project the workshop billing account is
 * charged for accounted for? It lists the billing account's projects (Cloud
 * Billing API, as the app service account — which holds `roles/billing.viewer`
 * for exactly this, see `infra/admin/iam.tf`) and matches each against the runs
 * table. Anything billed but unmatched — and not a known piece of control-plane
 * infra — is flagged as an orphan or an extraneous project someone stood up.
 *
 * Read-only throughout: `billing.viewer` cannot change billing or move projects,
 * and nothing here writes to the database.
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

type BillingProject = { projectId: string; billingEnabled: boolean };

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

function classify(err: unknown): AuditUnavailable {
  const status = (err as { response?: { status?: number } })?.response?.status;
  if (status === 403 || status === 401) return "permission_denied";
  return "unavailable";
}

const consoleUrl = (projectId: string) =>
  `https://console.cloud.google.com/home/dashboard?project=${encodeURIComponent(projectId)}`;

/**
 * List the billing account's projects and classify each against the database.
 * Returns a typed error rather than throwing, so the page can explain a missing
 * `billing.viewer` grant instead of 500-ing.
 */
export async function auditGcp(owners: OwnerMaps): Promise<CloudAuditResult> {
  const accountId = billingAccountId();
  if (!accountId) return { ok: false, error: "not_configured" };

  let billing: BillingProject[];
  try {
    billing = await listBillingProjects(accountId);
  } catch (err) {
    return { ok: false, error: classify(err) };
  }

  const names = await projectDisplayNames();
  const known = owners.byResource.gcp;
  const infra = infraProjectIds();

  const resources: AuditedResource[] = billing.map((p) => {
    const owner = known.get(p.projectId) ?? null;
    return {
      id: p.projectId,
      name: names.get(p.projectId) ?? null,
      url: consoleUrl(p.projectId),
      state: {
        label: p.billingEnabled ? "enabled" : "disabled",
        ok: p.billingEnabled,
      },
      // Every project here is billed to an account this deployment owns, so
      // there is no `unmanaged` case: it is ours whether we meant it or not.
      classification: owner
        ? "tracked"
        : infra.has(p.projectId)
          ? "infra"
          : "untracked",
      owner,
    };
  });

  return {
    ok: true,
    audit: {
      cloud: "gcp",
      scope: {
        label: "Billing account",
        value: accountId,
        name: null,
        url: `https://console.cloud.google.com/billing/${encodeURIComponent(accountId)}`,
      },
      columns: { id: "Project", name: "Project name", state: "Billing" },
      missing: missingFromCloud(
        known,
        billing.map((p) => p.projectId),
        infra,
      ),
      ...summarize(resources),
    },
  };
}
