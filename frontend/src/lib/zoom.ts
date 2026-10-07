/**
 * The Zoom API calls Google Meetings makes, with a Server-to-Server OAuth app
 * on the Zoom account the connected Google account belongs to: `ZOOM_ACCOUNT_ID`,
 * `ZOOM_CLIENT_ID` and `ZOOM_CLIENT_SECRET` (infra/admin/app.tf). The app
 * needs the `meeting:write:meeting:admin`, `meeting:read:meeting:admin`,
 * `meeting:update:meeting:admin`, `meeting:delete:meeting:admin` and
 * `user:read:user:admin` scopes. Unset, meetings are synced to Google Calendar
 * with no Zoom link.
 */

import "server-only";

const TOKEN = "https://zoom.us/oauth/token";
const API = "https://api.zoom.us/v2";

export type ZoomCredentials = { accountId: string; clientId: string; clientSecret: string };

export function zoomCredentials(): ZoomCredentials | null {
  const accountId = process.env.ZOOM_ACCOUNT_ID?.trim();
  const clientId = process.env.ZOOM_CLIENT_ID?.trim();
  const clientSecret = process.env.ZOOM_CLIENT_SECRET?.trim();
  return accountId && clientId && clientSecret ? { accountId, clientId, clientSecret } : null;
}

export class ZoomError extends Error {
  constructor(
    readonly status: number,
    /** Zoom's own error code, such as 3001 for a meeting that does not exist. */
    readonly code: number | null,
    message: string,
  ) {
    super(message);
  }

  get gone(): boolean {
    return this.status === 404 || this.code === 3001;
  }
}

export type ZoomClient = {
  /** One call; Zoom's JSON, or null for its empty 204. Throws `ZoomError`. */
  call<T>(method: string, path: string, body?: unknown): Promise<T>;
};

const RETRIES = 3;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function accountToken(creds: ZoomCredentials): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${TOKEN}?${new URLSearchParams({ grant_type: "account_credentials", account_id: creds.accountId })}`, {
      method: "POST",
      headers: { Authorization: `Basic ${Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString("base64")}` },
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
  } catch (err) {
    throw new ZoomError(0, null, `Could not reach Zoom: ${(err as Error).message}`);
  }
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; reason?: string; error?: string };
  if (!res.ok || !body.access_token) {
    throw new ZoomError(res.status, null, `Zoom refused the app's credentials: ${body.reason ?? body.error ?? `HTTP ${res.status}`}`);
  }
  return body.access_token;
}

/** A client for one sync; it fetches its token on the first call. */
export function zoomClient(creds: ZoomCredentials): ZoomClient {
  let token: Promise<string> | null = null;
  return {
    async call<T>(method: string, path: string, body?: unknown): Promise<T> {
      token ??= accountToken(creds);
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
