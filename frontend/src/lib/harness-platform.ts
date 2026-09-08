/** The Harness API calls this site makes. */

import "server-only";
import { createHash } from "node:crypto";
import type { HarnessPermissionCheck } from "@/db/schema";
import { PERMISSION_PROBES } from "@/lib/harness-permissions";

export function harnessBaseUrl(): string {
  return (process.env.HARNESS_BASE_URL ?? "https://app.harness.io").replace(
    /\/+$/,
    "",
  );
}

export const harnessOrgUrl = (accountId: string, org: string) =>
  `${harnessBaseUrl()}/ng/account/${accountId}/settings/organizations/${org}/details`;

export type ParsedToken = {
  kind: "pat" | "sat";
  accountId: string;
  tokenId: string;
  tail: string;
};

const TOKEN_SHAPE = /^(pat|sat)\.([A-Za-z0-9_-]{6,64})\.([A-Za-z0-9_-]{6,64})\.(\S{8,})$/;

export function parseHarnessToken(raw: string): ParsedToken | null {
  const match = TOKEN_SHAPE.exec(raw.trim());
  if (!match) return null;
  const [, kind, accountId, tokenId, secret] = match;
  return {
    kind: kind as "pat" | "sat",
    accountId: accountId!,
    tokenId: tokenId!,
    tail: secret!.slice(-4),
  };
}

export const fingerprint = (raw: string) =>
  createHash("sha256").update(raw.trim(), "utf8").digest("hex");

export type CheckError =
  | "malformed"
  | "invalid_token"
  | "harness_error"
  | "unreachable";

export type CheckResult =
  | {
      ok: true;
      token: ParsedToken;
      accountName: string | null;
      principal: string | null;
      principalType: string | null;
      permissions: HarnessPermissionCheck[];
    }
  | { ok: false; error: CheckError; detail?: string };

const TIMEOUT_MS = 12_000;

type HarnessResponse<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; message: string };

async function request<T>(
  path: string,
  token: string,
  body?: unknown,
): Promise<HarnessResponse<T>> {
  const res = await fetch(`${harnessBaseUrl()}${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      "x-api-key": token,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });

  const text = await res.text();
  type Envelope = { status?: string; data?: T; message?: string };
  let parsed: Envelope | null = null;
  try {
    parsed = JSON.parse(text) as Envelope;
  } catch {}

  if (!res.ok || !parsed?.data) {
    return {
      ok: false,
      status: res.status,
      message: parsed?.message ?? text.slice(0, 300),
    };
  }
  return { ok: true, status: res.status, data: parsed.data };
}

type AclResponse = {
  principal?: { principalIdentifier?: string; principalType?: string };
  accessControlList?: {
    permission?: string;
    resourceType?: string;
    permitted?: boolean;
  }[];
};

export async function checkHarnessToken(raw: string): Promise<CheckResult> {
  const token = raw.trim();
  const parsed = parseHarnessToken(token);
  if (!parsed) return { ok: false, error: "malformed" };

  const { accountId } = parsed;
  const scope = { accountIdentifier: accountId };

  let acl: HarnessResponse<AclResponse>;
  let account: HarnessResponse<{ name?: string }>;
  let currentUser: HarnessResponse<{ email?: string; name?: string }>;
  try {
    [acl, account, currentUser] = await Promise.all([
      request<AclResponse>("/authz/api/acl", token, {
        permissions: PERMISSION_PROBES.map((p) => ({
          resourceScope: scope,
          resourceType: p.resourceType,
          permission: p.permission,
        })),
      }),
      request<{ name?: string }>(`/ng/api/accounts/${accountId}`, token),
      request<{ email?: string; name?: string }>(
        `/ng/api/user/currentUser?accountIdentifier=${encodeURIComponent(accountId)}`,
        token,
      ),
    ]);
  } catch (err) {
    return {
      ok: false,
      error: "unreachable",
      detail: err instanceof Error ? err.message : undefined,
    };
  }

  if (!acl.ok) {
    if (acl.status === 401 || acl.status === 403) {
      return { ok: false, error: "invalid_token", detail: acl.message };
    }
    return { ok: false, error: "harness_error", detail: acl.message };
  }

  const answered = new Map(
    (acl.data.accessControlList ?? []).map((entry) => [
      `${entry.resourceType}:${entry.permission}`,
      entry.permitted === true,
    ]),
  );
  const permissions: HarnessPermissionCheck[] = PERMISSION_PROBES.map((p) => ({
    permission: p.permission,
    resourceType: p.resourceType,
    permitted: answered.get(`${p.resourceType}:${p.permission}`) ?? false,
  }));

  const principalType = acl.data.principal?.principalType ?? null;

  return {
    ok: true,
    token: parsed,
    accountName: account.ok ? (account.data.name ?? null) : null,
    principal: currentUser.ok
      ? (currentUser.data.email ?? null)
      : (acl.data.principal?.principalIdentifier ?? null),
    principalType,
    permissions,
  };
}

export type HarnessScope = {
  identifier: string;
  name: string;
};

export type ScopeListResult =
  | { ok: true; scopes: HarnessScope[] }
  | { ok: false; error: CheckError; detail?: string };

const PAGE_SIZE = 100;

const MAX_PAGES = 20;

function listError(status: number, message: string): ScopeListResult {
  if (status === 401 || status === 403) {
    return { ok: false, error: "invalid_token", detail: message };
  }
  return { ok: false, error: "harness_error", detail: message };
}

async function listScopes(
  token: string,
  path: string,
  unwrap: (entry: Record<string, unknown>) => Record<string, unknown> | undefined,
): Promise<ScopeListResult> {
  const scopes: HarnessScope[] = [];

  for (let page = 0; page < MAX_PAGES; page++) {
    let res: HarnessResponse<{ content?: Record<string, unknown>[] }>;
    try {
      res = await request<{ content?: Record<string, unknown>[] }>(
        `${path}${path.includes("?") ? "&" : "?"}pageIndex=${page}&pageSize=${PAGE_SIZE}`,
        token,
      );
    } catch (err) {
      return {
        ok: false,
        error: "unreachable",
        detail: err instanceof Error ? err.message : undefined,
      };
    }
    if (!res.ok) return listError(res.status, res.message);

    const content = res.data.content ?? [];
    for (const entry of content) {
      const inner = unwrap(entry);
      const identifier = inner?.identifier;
      if (typeof identifier !== "string" || identifier.length === 0) continue;
      const name = inner?.name;
      scopes.push({
        identifier,
        name: typeof name === "string" && name.length > 0 ? name : identifier,
      });
    }

    if (content.length < PAGE_SIZE) break;
  }

  return {
    ok: true,
    scopes: scopes.sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export async function listHarnessOrgs(raw: string): Promise<ScopeListResult> {
  const parsed = parseHarnessToken(raw.trim());
  if (!parsed) return { ok: false, error: "malformed" };

  return listScopes(
    raw.trim(),
    `/ng/api/organizations?accountIdentifier=${encodeURIComponent(parsed.accountId)}`,
    (entry) => entry.organization as Record<string, unknown> | undefined,
  );
}

export async function listHarnessProjects(
  raw: string,
  orgIdentifier: string,
): Promise<ScopeListResult> {
  const parsed = parseHarnessToken(raw.trim());
  if (!parsed) return { ok: false, error: "malformed" };

  return listScopes(
    raw.trim(),
    `/ng/api/projects?accountIdentifier=${encodeURIComponent(parsed.accountId)}` +
      `&orgIdentifier=${encodeURIComponent(orgIdentifier)}`,
    (entry) => entry.project as Record<string, unknown> | undefined,
  );
}

export type SourceCheck = {
  tokenOk: boolean;
  orgOk: boolean;
  projectOk: boolean | null;
  orgName?: string | null;
  projectName?: string | null;
  detail?: string;
};

function nameIn(data: unknown, key: "organization" | "project"): string | null {
  const inner = (data as Record<string, unknown> | null)?.[key];
  const name = (inner as Record<string, unknown> | undefined)?.name;
  return typeof name === "string" && name.length > 0 ? name : null;
}

export async function checkTemplateSource(
  raw: string,
  orgIdentifier: string,
  projectIdentifier?: string | null,
): Promise<SourceCheck> {
  const token = raw.trim();
  const parsed = parseHarnessToken(token);
  const wantsProject = Boolean(projectIdentifier);
  if (!parsed) {
    return {
      tokenOk: false,
      orgOk: false,
      projectOk: wantsProject ? false : null,
      detail: "The stored token is not in a shape Harness accepts.",
    };
  }

  const account = `accountIdentifier=${encodeURIComponent(parsed.accountId)}`;
  const org = `orgIdentifier=${encodeURIComponent(orgIdentifier)}`;

  let orgRes: HarnessResponse<unknown>;
  try {
    orgRes = await request(
      `/ng/api/organizations/${encodeURIComponent(orgIdentifier)}?${account}`,
      token,
    );
  } catch (err) {
    return {
      tokenOk: false,
      orgOk: false,
      projectOk: wantsProject ? false : null,
      detail: err instanceof Error ? err.message : "Could not reach Harness.",
    };
  }

  if (!orgRes.ok && orgRes.status === 401) {
    return {
      tokenOk: false,
      orgOk: false,
      projectOk: wantsProject ? false : null,
      detail: orgRes.message,
    };
  }
  if (!orgRes.ok) {
    return {
      tokenOk: true,
      orgOk: false,
      projectOk: wantsProject ? false : null,
      detail: orgRes.message,
    };
  }
  const orgName = nameIn(orgRes.data, "organization");
  if (!wantsProject) {
    return { tokenOk: true, orgOk: true, projectOk: null, orgName };
  }

  let projectRes: HarnessResponse<unknown>;
  try {
    projectRes = await request(
      `/ng/api/projects/${encodeURIComponent(projectIdentifier!)}?${account}&${org}`,
      token,
    );
  } catch (err) {
    return {
      tokenOk: true,
      orgOk: true,
      projectOk: false,
      orgName,
      detail: err instanceof Error ? err.message : "Could not reach Harness.",
    };
  }

  return {
    tokenOk: true,
    orgOk: true,
    projectOk: projectRes.ok,
    orgName,
    projectName: projectRes.ok ? nameIn(projectRes.data, "project") : null,
    detail: projectRes.ok ? undefined : projectRes.message,
  };
}

export async function harnessAccountName(raw: string): Promise<string | null> {
  const parsed = parseHarnessToken(raw.trim());
  if (!parsed) return null;
  try {
    const res = await request<{ name?: string }>(
      `/ng/api/accounts/${parsed.accountId}`,
      raw.trim(),
    );
    return res.ok ? (res.data.name ?? null) : null;
  } catch {
    return null;
  }
}
