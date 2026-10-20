/**
 * The Zoom OAuth and API calls Google Meetings makes, as the one Zoom user an
 * Assessments Administrator connected. The app is a user-managed General App
 * (`ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET`; infra/admin/app.tf) with only
 * user-level scopes: the past-meeting ones, to read who joined the calendar's
 * meetings that user hosts, and `meeting:delete:meeting`, to take down the
 * Zoom meetings the old create-a-meeting flow made. It reaches that user's
 * meetings and no one else's. The user signs in once through Zoom's consent
 * screen; the refresh token that returns is what every later sync acts with
 * (`lib/zoom-connection.ts` stores it). Unset, or with no user connected,
 * attendance is only what an administrator marks on the Current tab.
 */

import "server-only";

const AUTHORIZE = "https://zoom.us/oauth/authorize";
const TOKEN = "https://zoom.us/oauth/token";
const API = "https://api.zoom.us/v2";

/** What the app is set up with in the Zoom Marketplace; Zoom's consent screen asks for these. */
export const ZOOM_SCOPES = [
  "meeting:read:list_past_instances",
  "meeting:read:list_past_participants",
  "meeting:delete:meeting",
  // To read the connecting user's own email (`GET /users/me`); not the account-wide `:admin` scope.
  "user:read:user",
] as const;

export type ZoomApp = { clientId: string; clientSecret: string };

export function zoomApp(): ZoomApp | null {
  const clientId = process.env.ZOOM_CLIENT_ID?.trim();
  const clientSecret = process.env.ZOOM_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export class ZoomError extends Error {
  constructor(
    readonly status: number,
    /** Zoom's own error code, such as 3001 for a meeting that does not exist. */
    readonly code: number | null,
    message: string,
    /** Zoom's OAuth error, such as `invalid_grant`, from the token endpoint. */
    readonly reason: string | null = null,
  ) {
    super(message);
  }

  get gone(): boolean {
    return this.status === 404 || this.code === 3001;
  }

  /** The refresh token no longer works: the user removed the app, or it was already spent. */
  get revoked(): boolean {
    return this.reason === "invalid_grant";
  }
}

export type ZoomClient = {
  /** One call; Zoom's JSON, or null for its empty 204. Throws `ZoomError`. */
  call<T>(method: string, path: string, body?: unknown): Promise<T>;
};

const RETRIES = 3;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The consent screen to send the browser to. */
export function authorizationUrl(input: { clientId: string; redirectUri: string; state: string }): string {
  const url = new URL(AUTHORIZE);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    state: input.state,
  }).toString();
  return url.toString();
}

export type ZoomTokens = { accessToken: string; refreshToken: string; expiresAt: Date; scope: string };

async function tokenRequest(app: ZoomApp, params: Record<string, string>): Promise<ZoomTokens> {
  let res: Response;
  try {
    res = await fetch(TOKEN, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${app.clientId}:${app.clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(params),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
  } catch (err) {
    throw new ZoomError(0, null, `Could not reach Zoom: ${(err as Error).message}`);
  }
  const body = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    reason?: string;
    error?: string;
  };
  if (!res.ok || !body.access_token || !body.refresh_token) {
    throw new ZoomError(res.status, null, `Zoom refused the app's credentials: ${body.reason ?? body.error ?? `HTTP ${res.status}`}`, body.error ?? null);
  }
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: new Date(Date.now() + (body.expires_in ?? 3_600) * 1_000),
    scope: body.scope ?? "",
  };
}

/** Trades the code Zoom returned for the user's tokens. */
export function exchangeCode(app: ZoomApp, code: string, redirectUri: string): Promise<ZoomTokens> {
  return tokenRequest(app, { grant_type: "authorization_code", code, redirect_uri: redirectUri });
}

/** Zoom answers with a new refresh token too; the old one is spent. */
export function refreshTokens(app: ZoomApp, refreshToken: string): Promise<ZoomTokens> {
  return tokenRequest(app, { grant_type: "refresh_token", refresh_token: refreshToken });
}

/** Whether Zoom granted every scope the sync needs; it may name them with or without a suffix, or not say. */
export function grantedScopes(scope: string): boolean {
  if (!scope.trim()) return true;
  const granted = scope.split(/[\s,]+/);
  return ZOOM_SCOPES.every((needed) => granted.some((g) => g === needed || g.startsWith(`${needed}:`)));
}

/** The email of the user the token belongs to. */
export async function zoomUserEmail(accessToken: string): Promise<string> {
  const me = await zoomClient(async () => accessToken).call<{ email?: string }>("GET", "/users/me");
  if (!me.email) throw new ZoomError(200, null, "Zoom did not say whose account this is.");
  return me.email.toLowerCase();
}

/** A client for one sync; it asks for its token on the first call. */
export function zoomClient(accessToken: () => Promise<string>): ZoomClient {
  let token: Promise<string> | null = null;
  return {
    async call<T>(method: string, path: string, body?: unknown): Promise<T> {
      token ??= accessToken();
      const bearer = await token;
      for (let attempt = 0; ; attempt++) {
        let res: Response;
        try {
          res = await fetch(`${API}${path}`, {
            method,
            headers: {
              Authorization: `Bearer ${bearer}`,
              ...(body === undefined ? {} : { "Content-Type": "application/json" }),
            },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: AbortSignal.timeout(30_000),
            cache: "no-store",
          });
        } catch (err) {
          if (attempt < RETRIES) {
            await sleep(500 * 2 ** attempt);
            continue;
          }
          throw new ZoomError(0, null, `Could not reach Zoom: ${(err as Error).message}`);
        }
        if ((res.status === 429 || res.status >= 500) && attempt < RETRIES) {
          await sleep((Number(res.headers.get("retry-after")) || 2 ** attempt) * 1_000);
          continue;
        }
        const text = await res.text();
        let json: unknown = null;
        try {
          json = text ? JSON.parse(text) : null;
        } catch {
          // A 204 has no body; any other answer that is not JSON is reported below.
        }
        if (!res.ok) {
          const error = json as { code?: number; message?: string } | null;
          throw new ZoomError(res.status, error?.code ?? null, `Zoom ${method} ${path} answered ${res.status}: ${error?.message ?? text.slice(0, 200)}`);
        }
        return json as T;
      }
    },
  };
}
