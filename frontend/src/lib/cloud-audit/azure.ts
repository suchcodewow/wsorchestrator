import "server-only";

import { missingFromCloud, normalizeId, type OwnerMaps } from "./owners";
import {
  summarize,
  type AuditedResource,
  type AuditUnavailable,
  type CloudAuditResult,
  type Classification,
} from "./types";

/**
 * The Azure half of the Cloud Status page.
 *
 * The scope is the subscription and the boundary is the resource group: a
 * workshop gets one RG, a challenge one per competitor (see
 * `runner/terraform/workshops/azure-base` and `challenges/azure-per-user`).
 *
 * Azure differs from the other two clouds in one way that shapes everything
 * here: the subscription is *shared*. A GCP billing account and an AWS
 * organization are this deployment's alone, so anything in them is ours by
 * definition; a subscription also holds Azure's own bookkeeping groups
 * (`NetworkWatcherRG`, `DefaultResourceGroup-*`) and whatever else lives in the
 * tenant. Calling all of that orphaned would bury the one group that actually is.
 * So the audit leans on the `managed_by` tag the runner stamps on every RG it
 * creates (see `runner/src/workspace.ts`): only a tagged group can be
 * `untracked`, and the rest are reported as `unmanaged` — present, counted, not
 * alarming.
 *
 * Read-only: the only calls are list/get against ARM.
 */

const ARM = "https://management.azure.com";
const LOGIN = "https://login.microsoftonline.com";
const RG_API_VERSION = "2021-04-01";
const SUBSCRIPTION_API_VERSION = "2022-12-01";

/** The tag value `runner/src/workspace.ts` stamps on everything it creates. */
const MANAGED_BY = "workshop-orchestrator";

type AzureConfig = {
  subscriptionId: string;
  tenantId: string;
  clientId: string;
  clientSecret: string;
};

/**
 * The service principal the runner provisions with, read from the same env vars
 * (see `infra/admin/app.tf`). Any one missing means Azure isn't configured for
 * this deployment, and the page says so rather than erroring.
 */
function config(): AzureConfig | null {
  const subscriptionId =
    process.env.AZURE_SUBSCRIPTION_ID || process.env.ARM_SUBSCRIPTION_ID;
  const tenantId = process.env.AZURE_TENANT_ID || process.env.ARM_TENANT_ID;
  const clientId = process.env.ARM_CLIENT_ID;
  const clientSecret = process.env.ARM_CLIENT_SECRET;
  if (!subscriptionId || !tenantId || !clientId || !clientSecret) return null;
  return { subscriptionId, tenantId, clientId, clientSecret };
}

/** Resource groups that are permanent fixtures rather than runs. Comma-separated. */
function infraResourceGroups(): Set<string> {
  return new Set(
    (process.env.AZURE_INFRA_RESOURCE_GROUPS ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

class AzureError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * A client-credentials token for ARM, cached for its lifetime.
 *
 * Cached because the audit makes two or more calls per load and the page is
 * `force-dynamic`, so without this every refresh pays for a fresh token. Expiry
 * is trimmed by a minute so a token can't lapse mid-audit.
 */
let cached: { token: string; expiresAt: number } | null = null;

async function accessToken(cfg: AzureConfig): Promise<string> {
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  const res = await fetch(`${LOGIN}/${cfg.tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    cache: "no-store",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      scope: `${ARM}/.default`,
    }),
  });
  const body = (await res.json().catch(() => null)) as {
    access_token?: string;
    expires_in?: number;
    error_description?: string;
  } | null;

  if (!res.ok || !body?.access_token) {
    // A bad secret or an unknown app is a 400 from the login endpoint, not a
    // 403 — but from this page's point of view it is the same problem as a
    // missing role, so it is reported as one.
    throw new AzureError(
      res.status === 400 ? 403 : res.status,
      body?.error_description ?? "Could not get an Azure token",
    );
  }

  cached = {
    token: body.access_token,
    expiresAt: Date.now() + Math.max(0, (body.expires_in ?? 3600) - 60) * 1000,
  };
  return cached.token;
}

async function armGet<T>(cfg: AzureConfig, url: string): Promise<T> {
  const token = await accessToken(cfg);
  const res = await fetch(url, {
    cache: "no-store",
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new AzureError(res.status, text.slice(0, 200));
  }
  return (await res.json()) as T;
}

type ResourceGroup = {
  id?: string;
  name?: string;
  location?: string;
  managedBy?: string;
  tags?: Record<string, string> | null;
  properties?: { provisioningState?: string };
};

type ResourceGroupPage = { value?: ResourceGroup[]; nextLink?: string };

/** Every resource group in the subscription, following `nextLink`. */
async function listResourceGroups(cfg: AzureConfig): Promise<ResourceGroup[]> {
  const groups: ResourceGroup[] = [];
  let url: string | undefined =
    `${ARM}/subscriptions/${cfg.subscriptionId}/resourcegroups?api-version=${RG_API_VERSION}`;
  while (url) {
    const page: ResourceGroupPage = await armGet(cfg, url);
    groups.push(...(page.value ?? []));
    url = page.nextLink || undefined;
  }
  return groups;
}

/** The subscription's display name, so the header reads as more than a GUID. */
async function subscriptionName(cfg: AzureConfig): Promise<string | null> {
  try {
    const data = await armGet<{ displayName?: string }>(
      cfg,
      `${ARM}/subscriptions/${cfg.subscriptionId}?api-version=${SUBSCRIPTION_API_VERSION}`,
    );
    return data.displayName ?? null;
  } catch {
    // Optional enrichment — a principal scoped to a resource group can list
    // groups without being able to read the subscription itself.
    return null;
  }
}

const portalUrl = (cfg: AzureConfig, resourceId: string) =>
  `https://portal.azure.com/#@${cfg.tenantId}/resource${resourceId}`;

function classifyError(err: unknown): AuditUnavailable {
  if (!(err instanceof AzureError)) return "unavailable";
  return err.status === 401 || err.status === 403
    ? "permission_denied"
    : "unavailable";
}

export async function auditAzure(owners: OwnerMaps): Promise<CloudAuditResult> {
  const cfg = config();
  if (!cfg) return { ok: false, error: "not_configured" };

  let groups: ResourceGroup[];
  try {
    groups = await listResourceGroups(cfg);
  } catch (err) {
    return { ok: false, error: classifyError(err) };
  }

  // Only after the list succeeds — a failed audit shouldn't pay for a name.
  const name = await subscriptionName(cfg);

  const known = owners.byResource.azure;
  const infra = infraResourceGroups();

  const resources: AuditedResource[] = groups.flatMap((g) => {
    if (!g.name) return [];
    const id = normalizeId("azure", g.name);
    const ours = g.tags?.managed_by === MANAGED_BY;
    const state = g.properties?.provisioningState ?? "Unknown";
    // The name is the precise match — it knows which competitor owns a
    // challenge's group. The `run_id` tag is the fallback that catches the groups
    // AKS creates alongside a cluster, whose names nothing records.
    const owner =
      known.get(id) ??
      (ours && g.tags?.run_id ? owners.byRunTag.get(g.tags.run_id) ?? null : null);

    const classification: Classification = owner
      ? "tracked"
      : infra.has(id)
        ? "infra"
        : ours
          ? // Stamped by this orchestrator but claimed by no run: the real orphan.
            "untracked"
          : "unmanaged";

    return [
      {
        // The name, not the ARM id: it is what the run records and what the RG is
        // addressed by. The full id only ever feeds the portal link.
        id: g.name,
        name: g.location ?? null,
        url: g.id ? portalUrl(cfg, g.id) : null,
        state: { label: state.toLowerCase(), ok: state === "Succeeded" },
        classification,
        owner,
      } satisfies AuditedResource,
    ];
  });

  return {
    ok: true,
    audit: {
      target: "azure",
      scope: {
        label: "Subscription",
        value: cfg.subscriptionId,
        name,
        url: `https://portal.azure.com/#@${cfg.tenantId}/resource/subscriptions/${cfg.subscriptionId}/resourceGroups`,
      },
      columns: { id: "Resource group", name: "Location", state: "State" },
      missing: missingFromCloud(
        known,
        groups.flatMap((g) => (g.name ? [normalizeId("azure", g.name)] : [])),
        infra,
      ),
      ...summarize(resources),
    },
  };
}
