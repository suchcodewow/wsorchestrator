/** The Azure half of the Cloud Status page. */

import "server-only";

import { missingFromCloud, normalizeId, type OwnerMaps } from "./owners";
import {
  summarize,
  type AuditedResource,
  type AuditUnavailable,
  type CloudAuditResult,
  type Classification,
} from "./types";

const ARM = "https://management.azure.com";
const LOGIN = "https://login.microsoftonline.com";
const RG_API_VERSION = "2021-04-01";
const SUBSCRIPTION_API_VERSION = "2022-12-01";

const MANAGED_BY = "workshop-orchestrator";

type AzureConfig = {
  subscriptionId: string;
  tenantId: string;
  clientId: string;
  clientSecret: string;
};

function config(): AzureConfig | null {
  const subscriptionId =
    process.env.AZURE_SUBSCRIPTION_ID || process.env.ARM_SUBSCRIPTION_ID;
  const tenantId = process.env.AZURE_TENANT_ID || process.env.ARM_TENANT_ID;
  const clientId = process.env.ARM_CLIENT_ID;
  const clientSecret = process.env.ARM_CLIENT_SECRET;
  if (!subscriptionId || !tenantId || !clientId || !clientSecret) return null;
  return { subscriptionId, tenantId, clientId, clientSecret };
}

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

async function subscriptionName(cfg: AzureConfig): Promise<string | null> {
  try {
    const data = await armGet<{ displayName?: string }>(
      cfg,
      `${ARM}/subscriptions/${cfg.subscriptionId}?api-version=${SUBSCRIPTION_API_VERSION}`,
    );
    return data.displayName ?? null;
  } catch {
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

  const name = await subscriptionName(cfg);

  const known = owners.byResource.azure;
  const infra = infraResourceGroups();

  const resources: AuditedResource[] = groups.flatMap((g) => {
    if (!g.name) return [];
    const id = normalizeId("azure", g.name);
    const ours = g.tags?.managed_by === MANAGED_BY;
    const state = g.properties?.provisioningState ?? "Unknown";
    const owner =
      known.get(id) ??
      (ours && g.tags?.run_id ? owners.byRunTag.get(g.tags.run_id) ?? null : null);

    const classification: Classification = owner
      ? "tracked"
      : infra.has(id)
        ? "infra"
        : ours
          ?
            "untracked"
          : "unmanaged";

    return [
      {
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
