import "server-only";
import { createHash } from "node:crypto";
import type { HarnessPermissionCheck } from "@/db/schema";
import { PERMISSION_PROBES } from "@/lib/harness-permissions";

/**
 * Reading a Harness platform token: is it valid, whose account is it for, and
 * what may it do.
 *
 * Separate from the runner's Harness client (`runner/src/harness.ts`), which
 * builds workshops with the deployment's own shared key. This one never writes
 * anything: it exists so that a token a user pasted can be checked before it is
 * saved, and re-checked afterwards.
 */

/** Where Harness is. Multi-cluster accounts need this pointed at their own. */
export function harnessBaseUrl(): string {
  return (process.env.HARNESS_BASE_URL ?? "https://app.harness.io").replace(
    /\/+$/,
    "",
  );
}

/**
 * The Harness console page for an organization.
 *
 * Here rather than beside either caller, because both the deploy report and a
 * token row that remembers where it deployed link to the same place, and a URL
 * shape written out twice is a URL shape that drifts.
 */
export const harnessOrgUrl = (accountId: string, org: string) =>
  `${harnessBaseUrl()}/ng/account/${accountId}/settings/organizations/${org}/details`;

/**
 * A token's own structure. Harness tokens are
 * `<kind>.<accountId>.<tokenId>.<secret>`, which is why the account never has to
 * be asked for on the form — and why it is known even when the checks below all
 * fail.
 *
 * `pat` is a person's, `sat` a service account's. Nothing else is accepted:
 * first-generation Harness keys are opaque strings with no account in them, and
 * a token whose account we cannot name is one we cannot check.
 */
export type ParsedToken = {
  kind: "pat" | "sat";
  accountId: string;
  tokenId: string;
  /** Last four characters of the secret half — the only part ever redisplayed. */
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

/** Stable identity for a token, for the "you already saved this" check. */
export const fingerprint = (raw: string) =>
  createHash("sha256").update(raw.trim(), "utf8").digest("hex");

export type CheckError =
  /** Not `pat.…`/`sat.…` at all — rejected before any request is made. */
  | "malformed"
  /** Harness said the token is not valid: wrong, revoked, or expired. */
  | "invalid_token"
  /** Harness was reached and refused for some other reason. */
  | "harness_error"
  /** Harness could not be reached, or took too long. */
  | "unreachable";

export type CheckResult =
  | {
      ok: true;
      token: ParsedToken;
      /** What Harness calls the account, or null if the token can't read it. */
      accountName: string | null;
      /** Who the token acts as: an email where there is one, else an id. */
      principal: string | null;
      /** `USER` for a personal token, `SERVICE_ACCOUNT` for a service one. */
      principalType: string | null;
      permissions: HarnessPermissionCheck[];
    }
  | { ok: false; error: CheckError; detail?: string };

/** Long enough for a slow cluster, short enough that a form isn't left hanging. */
const TIMEOUT_MS = 12_000;

type HarnessResponse<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; message: string };

/**
 * One Harness request. No retries: this is a person waiting on a form, and the
 * only failures worth reporting here are ones a second attempt would report
 * identically — a token is valid or it isn't.
 */
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
    // Nothing here is cacheable: the whole point is what Harness says right now.
    cache: "no-store",
  });

  const text = await res.text();
  type Envelope = { status?: string; data?: T; message?: string };
  let parsed: Envelope | null = null;
  try {
    parsed = JSON.parse(text) as Envelope;
  } catch {
    // Harness answers JSON on every path used here; anything else is a gateway
    // or a proxy talking, and the body is the most useful thing to report.
  }

  if (!res.ok || !parsed?.data) {
    return {
      ok: false,
      status: res.status,
      message: parsed?.message ?? text.slice(0, 300),
    };
  }
  return { ok: true, status: res.status, data: parsed.data };
}

/** The ACL response, narrowed to the parts this reads. */
type AclResponse = {
  principal?: { principalIdentifier?: string; principalType?: string };
  accessControlList?: {
    permission?: string;
    resourceType?: string;
    permitted?: boolean;
  }[];
};

/**
 * Check a token with Harness.
 *
 * The ACL call is the one that decides validity, rather than the account or user
 * lookups: it answers for a service account exactly as it does for a person, and
 * every principal is allowed to ask what it may do. So a token that is real but
 * holds almost nothing still gets a straight answer, and the account name and
 * email become enrichment that may be missing rather than the test itself.
 *
 * All three go out together. They are independent, and a form that waits on
 * three sequential cross-region round trips feels broken even when it isn't.
 */
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
      // Only a person has one of these. A service account token gets an error
      // here, which is not a failure — it is how the two are told apart.
      request<{ email?: string; name?: string }>(
        `/ng/api/user/currentUser?accountIdentifier=${encodeURIComponent(accountId)}`,
        token,
      ),
    ]);
  } catch (err) {
    // Timeout or DNS/TLS failure. Distinct from a refusal: nothing was decided
    // about the token, so the message must not suggest it was rejected.
    return {
      ok: false,
      error: "unreachable",
      detail: err instanceof Error ? err.message : undefined,
    };
  }

  if (!acl.ok) {
    // Harness answers a wrong, revoked, or expired token with a 401 and
    // `INVALID_TOKEN`; the status alone is enough to tell the user which of
    // "not valid" and "something went wrong at Harness" happened.
    if (acl.status === 401 || acl.status === 403) {
      return { ok: false, error: "invalid_token", detail: acl.message };
    }
    return { ok: false, error: "harness_error", detail: acl.message };
  }

  // A permission Harness does not recognise comes back `permitted: false` rather
  // than as an error, so an identifier that goes stale would quietly read as a
  // grant the token lacks. The probe list is checked against a live account when
  // it changes; see `@/lib/harness-permissions`.
  const answered = new Map(
    (acl.data.accessControlList ?? []).map((entry) => [
      `${entry.resourceType}:${entry.permission}`,
      entry.permitted === true,
    ]),
  );
  const permissions: HarnessPermissionCheck[] = PERMISSION_PROBES.map((p) => ({
    permission: p.permission,
    resourceType: p.resourceType,
    // Absent from the response is not permitted. Harness returns one entry per
    // request, so this only fires if the shape changes under us.
    permitted: answered.get(`${p.resourceType}:${p.permission}`) ?? false,
  }));

  const principalType = acl.data.principal?.principalType ?? null;

  return {
    ok: true,
    token: parsed,
    accountName: account.ok ? (account.data.name ?? null) : null,
    // The email is what a person recognises; the ACL principal id is a uuid.
    // A service account has no email, so it falls back to that id.
    principal: currentUser.ok
      ? (currentUser.data.email ?? null)
      : (acl.data.principal?.principalIdentifier ?? null),
    principalType,
    permissions,
  };
}

/* ------------------------------------------------------------------ *
 * Scopes — the organizations and projects a token can see
 * ------------------------------------------------------------------ */

/**
 * One organization or project, as something to pick from a list. Both endpoints
 * answer with far more than this; the identifier is what gets stored and the
 * name is what a person recognises, and nothing here needs the rest.
 */
export type HarnessScope = {
  identifier: string;
  /** What Harness calls it, falling back to the identifier if it has no name. */
  name: string;
};

export type ScopeListResult =
  | { ok: true; scopes: HarnessScope[] }
  | { ok: false; error: CheckError; detail?: string };

/** Harness caps a page at 100 for these list endpoints. */
const PAGE_SIZE = 100;

/**
 * Enough for any real account, and a stop so a paging bug cannot spin here.
 * An account with more organizations than this has a bigger problem than a
 * truncated dropdown.
 */
const MAX_PAGES = 20;

/** How a refusal on a list endpoint is classified. Same rules as the token check. */
function listError(status: number, message: string): ScopeListResult {
  if (status === 401 || status === 403) {
    return { ok: false, error: "invalid_token", detail: message };
  }
  return { ok: false, error: "harness_error", detail: message };
}

/**
 * Walk a paged Harness list endpoint, pulling one field out of each entry.
 *
 * The two endpoints wrap their payload differently — an organization arrives as
 * `{ organization: {...} }` and a project as `{ project: {...} }` — so the
 * unwrapping is the caller's, and everything else about paging is shared.
 */
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

    // A short page is the last page. Cheaper to trust than `totalPages`, which
    // is only present on some of these responses.
    if (content.length < PAGE_SIZE) break;
  }

  // Sorted here rather than in the picker: this is the order somebody scans,
  // and Harness returns creation order, which is nobody's mental model of a
  // list of thirty organizations.
  return {
    ok: true,
    scopes: scopes.sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/**
 * Every organization the token can see. The account comes from the token
 * itself, so this takes nothing but the token — which is what lets the form be
 * one field and a button.
 */
export async function listHarnessOrgs(raw: string): Promise<ScopeListResult> {
  const parsed = parseHarnessToken(raw.trim());
  if (!parsed) return { ok: false, error: "malformed" };

  return listScopes(
    raw.trim(),
    `/ng/api/organizations?accountIdentifier=${encodeURIComponent(parsed.accountId)}`,
    (entry) => entry.organization as Record<string, unknown> | undefined,
  );
}

/** Every project in one organization that the token can see. */
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

/**
 * Whether a token still works and the org (and project) it names are still
 * there — the check behind the tick or the cross on each template source.
 *
 * Three findings rather than one boolean, because they fail for different
 * reasons and want different fixes: a revoked token is pasted again, a deleted
 * org means the row should go, and a project that has moved is a row to edit.
 * The distinction is drawn from the status Harness answers with — 401 is the
 * credential, 404 is the thing it asked for.
 *
 * A 403 counts against the *scope*, not the token: a valid token that may not
 * view an org cannot read templates from it either, so "this source does not
 * work" is the truthful reading and the token is not the part to replace.
 */
export type SourceCheck = {
  tokenOk: boolean;
  orgOk: boolean;
  /** Null when the source names no project — there is nothing to check. */
  projectOk: boolean | null;
  /**
   * What Harness currently calls them, when the lookup succeeded. Saving reads
   * the names from here rather than taking the picker's word for them, and a
   * re-check is also how a renamed org gets noticed.
   */
  orgName?: string | null;
  projectName?: string | null;
  /** What Harness said, when it said anything worth passing on. */
  detail?: string;
};

/** `{ organization: { name } }` and `{ project: { name } }`, defensively read. */
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
    // Nothing was decided — Harness was not reached. Reported as everything
    // failing, with the reason, rather than as a revoked token.
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

/**
 * What Harness calls an account, for naming a row. Null when the token cannot
 * read it — which a token perfectly able to read an org's templates may not be,
 * so this is enrichment and never a reason to refuse anything.
 */
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
