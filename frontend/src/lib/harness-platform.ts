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
