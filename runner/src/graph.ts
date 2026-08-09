import { azureCfg } from "./config.js";
import { withRetry } from "./retry.js";

/**
 * Microsoft Graph, for the one part of an attendee's Azure account Terraform
 * cannot create: their Temporary Access Pass.
 *
 * Microsoft now enforces MFA on sign-ins to the Azure portal tenant-wide, above
 * Conditional Access and independent of security defaults, so an attendee with
 * only a password no longer gets in. A workshop cannot answer that with an
 * authenticator app — the accounts live for hours, and enrolling thirty people
 * on their phones is the morning gone.
 *
 * A Temporary Access Pass is the way out: an admin-issued, time-limited
 * passcode that *is* a strong credential, so it satisfies the MFA requirement
 * with nothing to install and nothing to enrol. The attendee types it where the
 * password would go.
 *
 * The `azuread` Terraform provider has no resource for this — passes are issued
 * against a user that must already exist, they expire, and they are secrets
 * that would land in state — so it happens here, right after the apply that
 * creates the users.
 */

const LOGIN = "https://login.microsoftonline.com";
const GRAPH = "https://graph.microsoft.com/v1.0";

/** A Graph failure carrying its status, so `retry.ts` can judge it transient. */
class GraphError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "GraphError";
    this.status = status;
  }
}

/**
 * The app-only access token, cached for its lifetime.
 *
 * One token covers every attendee in a run — re-fetching per user would be
 * thirty round trips to buy nothing. Expiry is treated as a minute early so a
 * token cannot go stale between the check and the call that uses it.
 */
let cachedToken: { value: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.value;

  const cfg = azureCfg();
  if (!cfg.clientId || !cfg.clientSecret) {
    throw new Error(
      "ARM_CLIENT_ID and ARM_CLIENT_SECRET must be set to call Microsoft Graph",
    );
  }

  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    grant_type: "client_credentials",
    // `.default` asks for whatever application permissions the app has been
    // granted and consented for, which is where
    // UserAuthenticationMethod.ReadWrite.All has to be.
    scope: "https://graph.microsoft.com/.default",
  });

  const res = await fetch(`${LOGIN}/${cfg.tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const text = await res.text();
  if (!res.ok) {
    throw new GraphError(
      `Entra token request failed (${res.status}): ${text.slice(0, 300)}`,
      res.status,
    );
  }

  const json = JSON.parse(text) as { access_token: string; expires_in: number };
  cachedToken = {
    value: json.access_token,
    expiresAt: Date.now() + (json.expires_in - 60) * 1000,
  };
  return cachedToken.value;
}

/**
 * One Graph call, retried through `withRetry` on the transient statuses.
 *
 * 404 and 409 are deliberately left alone by that helper (it rethrows anything
 * non-transient unchanged), which is what lets the callers below treat "no pass
 * to delete" and "user not visible yet" as the ordinary conditions they are.
 */
async function graph<T>(
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T | undefined> {
  return withRetry(
    async () => {
      const res = await fetch(`${GRAPH}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${await accessToken()}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });

      if (res.status === 204) return undefined;

      const text = await res.text();
      if (!res.ok) {
        // Graph's own error shape; fall back to the raw body for the gateway
        // pages and throttling notices that never reach the API layer.
        let message = text.slice(0, 300);
        try {
          const parsed = JSON.parse(text) as {
            error?: { code?: string; message?: string };
          };
          if (parsed.error?.message) {
            message = `${parsed.error.code ?? "error"}: ${parsed.error.message}`;
          }
        } catch {
          // Not JSON — the raw slice above is the best available.
        }
        throw new GraphError(`${method} ${path} — ${message}`, res.status);
      }

      return text ? (JSON.parse(text) as T) : undefined;
    },
    { label: `Microsoft Graph (${method} ${path})` },
  );
}

/** The tenant's Temporary Access Pass policy, which constrains what we ask for. */
export type TapPolicy = {
  state: "enabled" | "disabled";
  minimumLifetimeInMinutes: number;
  maximumLifetimeInMinutes: number;
  /** True when the tenant requires every pass to be single-use. */
  isUsableOnce: boolean;
};

/**
 * Read the TAP policy, or undefined if it cannot be read.
 *
 * Worth one call per run rather than guessing: a pass whose lifetime falls
 * outside the tenant's configured bounds is rejected outright, and the bounds
 * are a tenant setting nothing here controls. `isUsableOnce` matters for the
 * same reason — a tenant that mandates single-use passes overrides the
 * runner's preference, and asking for multi-use anyway just fails.
 */
export async function tapPolicy(): Promise<TapPolicy | undefined> {
  const policy = await graph<{
    state?: string;
    minimumLifetimeInMinutes?: number;
    maximumLifetimeInMinutes?: number;
    isUsableOnce?: boolean;
  }>(
    "GET",
    "/policies/authenticationMethodsPolicy/authenticationMethodConfigurations/TemporaryAccessPass",
  );
  if (!policy) return undefined;

  return {
    state: policy.state === "enabled" ? "enabled" : "disabled",
    // The documented defaults, for a policy that omits them.
    minimumLifetimeInMinutes: policy.minimumLifetimeInMinutes ?? 10,
    maximumLifetimeInMinutes: policy.maximumLifetimeInMinutes ?? 480,
    isUsableOnce: policy.isUsableOnce ?? false,
  };
}

export type IssuedPass = {
  /** The passcode itself — this is what the attendee types. */
  code: string;
  /** When it stops working. */
  expiresAt: Date;
  /** Whether it can only be used for a single sign-in. */
  oneTime: boolean;
};

/**
 * Issue a Temporary Access Pass for one attendee, replacing any they have.
 *
 * A user can hold only one pass at a time, so an existing one is deleted first
 * rather than left to collide — which is what makes this safe to run again on a
 * workshop that grew, or on a retry after a partial failure. The attendee ends
 * up with exactly one working pass either way.
 *
 * `startDateTime` is left unset so the pass is valid immediately: a workshop is
 * provisioned up to `PROVISION_LEAD_HOURS` before the room opens, and a pass
 * that only starts later would be a support question from whoever tries it
 * early.
 */
export async function issueAccessPass(
  upn: string,
  opts: { lifetimeInMinutes: number; oneTime: boolean },
): Promise<IssuedPass> {
  const base = `/users/${encodeURIComponent(upn)}/authentication/temporaryAccessPassMethods`;

  // Clear whatever is there. A 404 means the user has no pass — or, just after
  // an apply, that Entra has not finished replicating the user; either way
  // there is nothing to delete and the create below is the call that matters.
  try {
    const existing = await graph<{ value?: { id: string }[] }>("GET", base);
    for (const method of existing?.value ?? []) {
      await graph("DELETE", `${base}/${method.id}`);
    }
  } catch (err) {
    if (statusOf(err) !== 404) throw err;
  }

  const created = await graph<{
    temporaryAccessPass?: string;
    lifetimeInMinutes?: number;
    startDateTime?: string;
    isUsableOnce?: boolean;
  }>("POST", base, {
    lifetimeInMinutes: opts.lifetimeInMinutes,
    isUsableOnce: opts.oneTime,
  });

  if (!created?.temporaryAccessPass) {
    // The pass is returned exactly once, at creation; there is no reading it
    // back later. A response without one is a failure however it is dressed.
    throw new Error(`Entra returned no access pass for ${upn}`);
  }

  const startedAt = created.startDateTime
    ? new Date(created.startDateTime)
    : new Date();
  const minutes = created.lifetimeInMinutes ?? opts.lifetimeInMinutes;

  return {
    code: created.temporaryAccessPass,
    expiresAt: new Date(startedAt.getTime() + minutes * 60_000),
    oneTime: created.isUsableOnce ?? opts.oneTime,
  };
}

/** HTTP status of a Graph failure, for the callers' idempotency checks. */
function statusOf(err: unknown): number | undefined {
  return err instanceof GraphError ? err.status : undefined;
}
