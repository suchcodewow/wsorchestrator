/** The Harness half of the Cloud Status page. */

import "server-only";

import { harnessBaseUrl } from "@/lib/harness-platform";
import { missingFromCloud, type OwnerMaps } from "./owners";
import {
  summarize,
  type AuditedResource,
  type AuditUnavailable,
  type Classification,
  type CloudAuditResult,
} from "./types";

const MANAGED_BY = "workshop-orchestrator";

const PAGE_SIZE = 100;

const TIMEOUT_MS = 12_000;

type HarnessConfig = { accountId: string; apiKey: string; baseUrl: string };

function config(): HarnessConfig | null {
  const accountId = process.env.HARNESS_ACCOUNT_ID;
  const apiKey = process.env.HARNESS_API_KEY;
  if (!accountId || !apiKey) return null;
  return { accountId, apiKey, baseUrl: harnessBaseUrl() };
}

function infraOrgs(): Set<string> {
  return new Set(
    (process.env.HARNESS_INFRA_ORGS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

class HarnessError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

type Organization = {
  identifier?: string;
  name?: string;
  tags?: Record<string, string> | null;
};

type OrganizationEntry = {
  organization?: Organization;
  createdAt?: number;
  harnessManaged?: boolean;
};

type OrganizationPage = {
  data?: { content?: OrganizationEntry[]; totalPages?: number };
  message?: string;
};

async function listOrgs(cfg: HarnessConfig): Promise<OrganizationEntry[]> {
  const orgs: OrganizationEntry[] = [];
  for (let pageIndex = 0; ; pageIndex++) {
    const params = new URLSearchParams({
      accountIdentifier: cfg.accountId,
      pageIndex: String(pageIndex),
      pageSize: String(PAGE_SIZE),
    });
    const res = await fetch(`${cfg.baseUrl}/ng/api/organizations?${params}`, {
      headers: { "x-api-key": cfg.apiKey, accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });

    const text = await res.text();
    let body: OrganizationPage | null = null;
    try {
      body = JSON.parse(text) as OrganizationPage;
    } catch {}
    if (!res.ok) {
      throw new HarnessError(res.status, body?.message ?? text.slice(0, 200));
    }

    const content = body?.data?.content ?? [];
    orgs.push(...content);
    const totalPages = body?.data?.totalPages ?? 1;
    if (content.length === 0 || pageIndex + 1 >= totalPages) break;
  }
  return orgs;
}

async function accountName(cfg: HarnessConfig): Promise<string | null> {
  try {
    const res = await fetch(`${cfg.baseUrl}/ng/api/accounts/${cfg.accountId}`, {
      headers: { "x-api-key": cfg.apiKey, accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: { name?: string } };
    return body.data?.name ?? null;
  } catch {
    return null;
  }
}

const orgUrl = (cfg: HarnessConfig, identifier: string) =>
  `${cfg.baseUrl}/ng/account/${cfg.accountId}/settings/organizations/${encodeURIComponent(identifier)}/details`;

const orgsUrl = (cfg: HarnessConfig) =>
  `${cfg.baseUrl}/ng/account/${cfg.accountId}/settings/organizations`;

function createdOn(entry: OrganizationEntry): { label: string; ok: boolean } | null {
  const ms = entry.createdAt;
  if (typeof ms !== "number" || !Number.isFinite(ms)) return null;
  return { label: new Date(ms).toISOString().slice(0, 10), ok: true };
}

function classifyError(err: unknown): AuditUnavailable {
  if (!(err instanceof HarnessError)) return "unavailable";
  return err.status === 401 || err.status === 403
    ? "permission_denied"
    : "unavailable";
}

export async function auditHarness(owners: OwnerMaps): Promise<CloudAuditResult> {
  const cfg = config();
  if (!cfg) return { ok: false, error: "not_configured" };

  let entries: OrganizationEntry[];
  try {
    entries = await listOrgs(cfg);
  } catch (err) {
    return { ok: false, error: classifyError(err) };
  }

  const name = await accountName(cfg);

  const known = owners.byResource.harness;
  const infra = infraOrgs();

  const resources: AuditedResource[] = entries.flatMap((entry) => {
    const identifier = entry.organization?.identifier;
    if (!identifier) return [];

    const ours = entry.organization?.tags?.managed_by === MANAGED_BY;
    const owner = known.get(identifier) ?? null;

    const classification: Classification = owner
      ? "tracked"
      : infra.has(identifier) || entry.harnessManaged
        ? "infra"
        : ours
          ?
            "untracked"
          : "unmanaged";

    return [
      {
        id: identifier,
        name: entry.organization?.name ?? null,
        url: orgUrl(cfg, identifier),
        state: createdOn(entry),
        classification,
        owner,
      } satisfies AuditedResource,
    ];
  });

  return {
    ok: true,
    audit: {
      target: "harness",
      scope: {
        label: "Harness account",
        value: cfg.accountId,
        name,
        url: orgsUrl(cfg),
      },
      columns: { id: "Organization", name: "Event name", state: "Created" },
      missing: missingFromCloud(
        known,
        entries.flatMap((e) =>
          e.organization?.identifier ? [e.organization.identifier] : [],
        ),
        infra,
      ),
      ...summarize(resources),
    },
  };
}
