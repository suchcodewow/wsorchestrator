/**
 * Mindtickle's standard REST API and its xAPI statements, with a self-service
 * key pair (Account → Settings → Security and Integrations). Progress state
 * only, no scores. Ported from canary-wire-reports' `rest.py`.
 */

import "server-only";

import type { MtRecord } from "@/lib/canary-wire/records";

const API_HOSTS = { global: "https://api.mindtickle.com", us: "https://api.prod-us.mindtickle.com" } as const;
type Region = keyof typeof API_HOSTS;

// Documented limits are 5/sec, 220/min and 3,000/hour. Under ~3.5/sec keeps
// the per-learner sweep inside the minute budget too.
const MIN_INTERVAL_MS = 300;
const USERS_PAGE = 50;
// Not in the docs, but anything above is refused: "Limit cannot be greater than 20!"
const XAPI_PAGE = 20;
const MAX_ATTEMPTS = 5;
const TIMEOUT_MS = 60_000;

export class MindtickleError extends Error {}

/** The key pair itself was refused: no point asking about the next learner. */
export class MindtickleAuthError extends MindtickleError {}

export type MindtickleConfig = { apiKey: string; secretKey: string; lsUrl: string; companyId: string; region: Region };

/**
 * The key pair and tenant from the environment, or null when they aren't set.
 * Only the key pair is secret: the tenant names Harness's site and grants nothing.
 */
export function mindtickleConfig(): MindtickleConfig | null {
  const apiKey = process.env.MT_API_KEY ?? "";
  const secretKey = process.env.MT_SECRET_KEY ?? "";
  const lsUrl = process.env.MT_LS_URL ?? "";
  const companyId = process.env.MT_COMPANY_ID ?? "";
  const region = (process.env.MT_REGION || "us") as Region;
  if (!apiKey || !secretKey || (!lsUrl && !companyId) || !(region in API_HOSTS)) return null;
  return { apiKey, secretKey, lsUrl, companyId, region };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Mindtickle {
  private readonly host: string;
  private token: string | null = null;
  private tokenExpires = 0;
  private last = 0;

  constructor(private readonly config: MindtickleConfig) {
    this.host = API_HOSTS[config.region];
  }

  private async throttle() {
    const wait = MIN_INTERVAL_MS - (Date.now() - this.last);
    if (wait > 0) await sleep(wait);
  }

  private async authenticate() {
    // The console hands out a company id and the docs name the tenant ls_url;
    // both name the same tenant, so whichever is set is sent.
    const body: Record<string, string> = { api_key: this.config.apiKey, secret_key: this.config.secretKey };
    if (this.config.lsUrl) body.ls_url = this.config.lsUrl;
    if (this.config.companyId) body.company_id = this.config.companyId;
    await this.throttle();
    let res: Response;
    try {
      res = await fetch(`${this.host}/services/data/auth_token`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      throw new MindtickleError(`Signing in to Mindtickle failed: ${(err as Error).message}`);
    } finally {
      this.last = Date.now();
    }
    if ([400, 401, 403].includes(res.status)) {
      throw new MindtickleAuthError(
        `Mindtickle refused the key pair (${res.status}). Check MT_API_KEY, MT_SECRET_KEY and the tenant, and that the pair is active in Account → Settings → Security and Integrations.`,
      );
    }
    if (!res.ok) throw new MindtickleError(`Signing in to Mindtickle returned ${res.status}.`);
    const payload = (await res.json().catch(() => ({}))) as { token?: string; access_token?: string; expires_in?: number };
    const token = payload.token ?? payload.access_token;
    if (!token) throw new MindtickleError("Mindtickle's sign-in answer had no token.");
    this.token = token;
    // Renewed a minute early so a step never fails mid-flight.
    this.tokenExpires = Date.now() + (Number(payload.expires_in) || 3600) * 1000 - 60_000;
  }

  private async call(method: "GET" | "POST", path: string, body?: unknown): Promise<MtRecord> {
    const url = path.startsWith("http") ? path : `${this.host}${path}`;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (!this.token || Date.now() >= this.tokenExpires) await this.authenticate();
      await this.throttle();
      let res: Response;
      try {
        res = await fetch(url, {
          method,
          headers: { authorization: `Bearer ${this.token}`, accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (err) {
        this.last = Date.now();
        if (attempt === MAX_ATTEMPTS) throw new MindtickleError(`${new URL(url).pathname}: ${(err as Error).message}`);
        await sleep(2 ** attempt * 1000);
        continue;
      }
      this.last = Date.now();
      if (res.status === 429) {
        await sleep((Number(res.headers.get("retry-after")) || 2 ** attempt) * 1000);
        continue;
      }
      if (res.status === 401 && attempt < MAX_ATTEMPTS) {
        // Revoked or expired early.
        this.token = null;
        continue;
      }
      if (res.status >= 500) {
        if (attempt === MAX_ATTEMPTS) throw new MindtickleError(`${new URL(url).pathname}: ${res.status} after ${attempt} attempts`);
        await sleep(2 ** attempt * 1000);
        continue;
      }
      if (!res.ok) throw new MindtickleError(`${new URL(url).pathname}: ${res.status} ${(await res.text()).slice(0, 300)}`);
      try {
        return (await res.json()) as MtRecord;
      } catch {
        throw new MindtickleError(`${new URL(url).pathname}: the answer wasn't JSON`);
      }
    }
    throw new MindtickleError(`${new URL(url).pathname}: gave up after ${MAX_ATTEMPTS} attempts`);
  }

  /**
   * An API-supplied URL moved onto the host we signed in to. Continuations
   * come back on api.mindtickle.com whichever regional host served the
   * request, and the global host 500s for a us-region tenant — which once
   * silently emptied every long history. The path and query stay verbatim:
   * re-applying the filters breaks them.
   */
  sameHost(url: string): string {
    if (!/^https?:\/\//.test(url)) return `${this.host}${url.startsWith("/") ? "" : "/"}${url}`;
    const u = new URL(url);
    return `${this.host}${u.pathname}${u.search}`;
  }

  async listSeries(): Promise<MtRecord[]> {
    return ((await this.call("GET", "/api/v2/series/list")).hits as MtRecord[]) ?? [];
  }

  async listSeriesModules(seriesId: string): Promise<MtRecord[]> {
    return ((await this.call("GET", `/api/v2/series/${encodeURIComponent(seriesId)}/list`)).hits as MtRecord[]) ?? [];
  }

  /** `{ id: name }`. Groups live on v2.0, not v4.0 like Users, and are matched by exact name. */
  async groupsNamed(names: string[]): Promise<Map<string, string>> {
    const payload = await this.call("POST", "/services/data/v2.0/mtobjects/Groups", { names });
    const out = new Map<string, string>();
    for (const g of (payload.groups as MtRecord[]) ?? []) if (g.id) out.set(String(g.id), String(g.name ?? ""));
    return out;
  }

  async usersInGroup(groupId: string): Promise<MtRecord[]> {
    const users: MtRecord[] = [];
    let payload = await this.call("POST", `/services/data/v4.0/mtobjects/Users?limit=${USERS_PAGE}`, { groupIds: [groupId] });
    for (;;) {
      const batch = (payload.users as MtRecord[]) ?? [];
      users.push(...batch);
      const next = payload.nextRecordsUrl;
      // Continuations are GETs, though the first call is a POST.
      if (payload.done || !next || !batch.length) return users;
      payload = await this.call("GET", this.sameHost(String(next)));
    }
  }

  /** Every statement for one learner — their whole history; xAPI can't scope it to a module. */
  async statementsFor(email: string): Promise<MtRecord[]> {
    const agent = encodeURIComponent(JSON.stringify({ mbox: `mailto:${email}` }));
    let url = `/services/data/v4.0/xapi/statements?agent=${agent}&limit=${XAPI_PAGE}`;
    const statements: MtRecord[] = [];
    const seen = new Set<string>();
    for (;;) {
      const payload = await this.call("GET", url);
      statements.push(...((payload.statements as MtRecord[]) ?? []));
      if (!payload.more) return statements;
      url = this.sameHost(String(payload.more));
      if (seen.has(url)) return statements;
      seen.add(url);
    }
  }
}
