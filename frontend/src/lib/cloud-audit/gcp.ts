/** The Google Cloud half of the Cloud Status page. */

import "server-only";

import { GoogleAuth } from "google-auth-library";
import { missingFromCloud, type OwnerMaps } from "./owners";
import {
  summarize,
  type AuditedResource,
  type AuditUnavailable,
  type CloudAuditResult,
} from "./types";

const BILLING_API = "https://cloudbilling.googleapis.com/v1";
const RESOURCE_MANAGER_API = "https://cloudresourcemanager.googleapis.com/v3";

export function billingAccountId(): string | null {
  return process.env.GCP_BILLING_ACCOUNT_ID || null;
}

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
  } catch {}
  return names;
}

function classify(err: unknown): AuditUnavailable {
  const status = (err as { response?: { status?: number } })?.response?.status;
  if (status === 403 || status === 401) return "permission_denied";
  return "unavailable";
}

const consoleUrl = (projectId: string) =>
  `https://console.cloud.google.com/home/dashboard?project=${encodeURIComponent(projectId)}`;

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

  const resources: AuditedResource[] = billing.flatMap((p) => {
    if (!p.billingEnabled) return [];

    const owner = known.get(p.projectId) ?? null;
    return [
      {
        id: p.projectId,
        name: names.get(p.projectId) ?? null,
        url: consoleUrl(p.projectId),
        state: { label: "enabled", ok: true },
        classification: owner
          ? "tracked"
          : infra.has(p.projectId)
            ? "infra"
            : "untracked",
        owner,
      } satisfies AuditedResource,
    ];
  });

  return {
    ok: true,
    audit: {
      target: "gcp",
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
