/**
 * Fixtures for the cloud-audit tests: owner maps, a fetch that never leaves
 * the process, and an environment snapshot.
 *
 * The audits classify what a cloud holds against what the runs claim. That
 * logic sits behind a `fetch`, so the tests replace `globalThis.fetch` with a
 * router over canned responses. A request the router does not recognise
 * throws, so a test can never fall through to the real network.
 */

import { afterEach, beforeEach } from "node:test";

import type { AuditTarget, ResourceOwner } from "@/lib/cloud-audit/types";
import type { OwnerMaps } from "@/lib/cloud-audit/owners";

export const owner = (runId: string, extra: Partial<ResourceOwner> = {}): ResourceOwner => ({
  runId,
  name: `Run ${runId}`,
  status: "ready",
  mode: "workshop",
  ...extra,
});

export function ownerMaps(
  byResource: Partial<Record<AuditTarget, Record<string, ResourceOwner>>> = {},
  byRunTag: Record<string, ResourceOwner> = {},
): OwnerMaps {
  const map = (t: AuditTarget) => new Map(Object.entries(byResource[t] ?? {}));
  return {
    byResource: { aws: map("aws"), azure: map("azure"), gcp: map("gcp"), harness: map("harness") },
    byRunTag: new Map(Object.entries(byRunTag)),
  };
}

export type Call = { url: string; init: RequestInit | undefined };

export type Route = (url: URL, init: RequestInit | undefined) => Response | Promise<Response> | undefined;

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/**
 * Replace `fetch` for the duration of each test in the calling file. `routes`
 * is read at call time, so a test sets `fake.route` before invoking the audit.
 */
export function installFakeFetch() {
  const fake = { calls: [] as Call[], route: (() => undefined) as Route };
  let original: typeof fetch;
  beforeEach(() => {
    original = globalThis.fetch;
    fake.calls = [];
    fake.route = () => undefined;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      fake.calls.push({ url, init });
      const res = await fake.route(new URL(url), init);
      if (!res) throw new Error(`unexpected request in a unit test: ${init?.method ?? "GET"} ${url}`);
      return res;
    }) as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = original;
  });
  return fake;
}

/** Clear `keys` before each test and put back whatever was there after it. */
export function withCleanEnv(keys: readonly string[]) {
  let saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    for (const k of keys) delete process.env[k];
  });
  afterEach(() => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });
}
