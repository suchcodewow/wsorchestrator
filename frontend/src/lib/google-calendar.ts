/**
 * The Google OAuth and Calendar API calls Google Meetings makes, as the one
 * Google account an Assessments Administrator connected. Google's APIs take no
 * password: the account signs in once through the consent screen, with the
 * app's own OAuth client (`AUTH_GOOGLE_ID`), and the refresh token that returns
 * is what every later sync acts with.
 *
 * Each call retries a 429 or a 5xx a few times, as Google asks, before giving up.
 */

import "server-only";

const AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com/calendar/v3";

/** `calendar` itself: the sync makes a calendar and shares it, which the narrower scopes cannot. */
export const GOOGLE_MEETING_SCOPES = ["openid", "email", "https://www.googleapis.com/auth/calendar"];

export class GoogleError extends Error {
  constructor(
    readonly status: number,
    /** Google's own reason, such as `invalid_grant` or `notFound`, when it gave one. */
    readonly reason: string,
    message: string,
  ) {
    super(message);
  }

  /** The refresh token no longer works: the account revoked it, or its password changed. */
  get revoked(): boolean {
    return this.reason === "invalid_grant";
  }

  get gone(): boolean {
    return this.status === 404 || this.status === 410;
  }
}

export function oauthClient(): { id: string; secret: string } | null {
  const id = process.env.AUTH_GOOGLE_ID?.trim();
  const secret = process.env.AUTH_GOOGLE_SECRET?.trim();
  return id && secret ? { id, secret } : null;
}

/** The consent screen to send the browser to. `prompt=consent` makes Google return a refresh token every time. */
export function authorizationUrl(input: { clientId: string; redirectUri: string; state: string; loginHint?: string }): string {
  const url = new URL(AUTHORIZE);
  url.search = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    scope: GOOGLE_MEETING_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "false",
    state: input.state,
    ...(input.loginHint ? { login_hint: input.loginHint } : {}),
  }).toString();
  return url.toString();
}

type TokenAnswer = {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
};

async function tokenRequest(params: Record<string, string>): Promise<TokenAnswer> {
  let res: Response;
  try {
    res = await fetch(TOKEN, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
  } catch (err) {
    throw new GoogleError(0, "unreachable", `Could not reach Google: ${(err as Error).message}`);
  }
  const body = (await res.json().catch(() => ({}))) as TokenAnswer;
  if (!res.ok || body.error) {
    const reason = body.error ?? `http_${res.status}`;
    throw new GoogleError(res.status, reason, `Google refused the token request: ${body.error_description ?? reason}`);
  }
  return body;
}

/**
 * The email in an ID token that came straight from Google's token endpoint.
 * Its signature needs no check: it arrived over TLS from Google itself, which
 * OpenID Connect allows for the code flow.
 */
function idTokenEmail(idToken: string | undefined): string | null {
  const payload = idToken?.split(".")[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { email?: unknown; email_verified?: unknown };
    return typeof claims.email === "string" && claims.email_verified !== false ? claims.email.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** Trades the consent screen's code for the account's refresh token and email. */
export async function exchangeCode(
  client: { id: string; secret: string },
  code: string,
  redirectUri: string,
): Promise<{ refreshToken: string; scope: string; email: string }> {
  const body = await tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: client.id,
    client_secret: client.secret,
  });
  const email = idTokenEmail(body.id_token);
  if (!body.refresh_token || !email) {
    throw new GoogleError(400, "incomplete", "Google returned no refresh token or no email; try connecting again.");
  }
  return { refreshToken: body.refresh_token, scope: body.scope ?? "", email };
}

export async function accessToken(client: { id: string; secret: string }, refreshToken: string): Promise<string> {
  const body = await tokenRequest({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: client.id,
    client_secret: client.secret,
  });
  if (!body.access_token) throw new GoogleError(500, "no_access_token", "Google returned no access token.");
  return body.access_token;
}

export type CalendarClient = {
  /** One call; the JSON Google answers with, or null for an empty answer. Throws `GoogleError`. */
  call<T>(method: string, path: string, options?: { query?: Record<string, string>; body?: unknown }): Promise<T>;
};

const RETRIES = 3;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function calendarClient(token: string): CalendarClient {
  return {
    async call<T>(method: string, path: string, options: { query?: Record<string, string>; body?: unknown } = {}): Promise<T> {
      const url = `${API}${path}${options.query ? `?${new URLSearchParams(options.query)}` : ""}`;
      for (let attempt = 0; ; attempt++) {
        let res: Response;
        try {
          res = await fetch(url, {
            method,
            headers: {
              Authorization: `Bearer ${token}`,
              ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
            },
            body: options.body === undefined ? undefined : JSON.stringify(options.body),
            signal: AbortSignal.timeout(30_000),
            cache: "no-store",
          });
        } catch (err) {
          if (attempt < RETRIES) {
            await sleep(500 * 2 ** attempt);
            continue;
          }
          throw new GoogleError(0, "unreachable", `Could not reach Google Calendar: ${(err as Error).message}`);
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
          if (res.ok) throw new GoogleError(res.status, "not_json", `Google Calendar ${method} ${path} answered with no JSON`);
        }
        if (!res.ok) {
          const error = (json as { error?: { message?: string; errors?: { reason?: string }[] } } | null)?.error;
          const reason = error?.errors?.[0]?.reason ?? `http_${res.status}`;
          throw new GoogleError(res.status, reason, `Google Calendar ${method} ${path} answered ${res.status}: ${error?.message ?? reason}`);
        }
        return json as T;
      }
    },
  };
}
