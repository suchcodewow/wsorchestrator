/**
 * The published API reference (/api) against the route files it describes.
 *
 * The catalog is written by hand, so the only thing keeping it true is this:
 * every exported method of every route file has exactly one entry, nothing
 * is documented that does not exist, and an entry says "session only"
 * exactly where the handler calls `auth()` itself (directly or through a
 * helper in the same file) instead of going through `requireCaller`.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { ACCESS_LABELS, GROUPS, endpointAnchor } from "@/lib/api-reference";
import { API_DIR, CALLS_AUTH, routeFiles, topLevelFunctions, urlPath } from "../support/routes";

/** "GET /api/runs" → whether the handler takes a token. */
function routesInCode(): Map<string, boolean> {
  const routes = new Map<string, boolean>();
  for (const file of routeFiles(API_DIR)) {
    const source = readFileSync(file, "utf8");
    const path = urlPath(file);
    const fns = topLevelFunctions(source);
    const sessionHelpers = [...fns]
      .filter(([, f]) => !f.exported && CALLS_AUTH.test(f.body))
      .map(([name]) => name);

    for (const [name, fn] of fns) {
      if (!fn.exported || !/^(GET|POST|PUT|PATCH|DELETE)$/.test(name)) continue;
      const sessionOnly =
        CALLS_AUTH.test(fn.body) ||
        sessionHelpers.some((h) => new RegExp(`\\b${h}\\(`).test(fn.body));
      routes.set(`${name} ${path}`, !sessionOnly);
    }

    // `export const { GET, POST } = handlers;` — Auth.js's own routes.
    for (const m of source.matchAll(/^export const \{([^}]+)\}/gm)) {
      for (const name of m[1]!.split(",").map((s) => s.trim())) {
        if (/^(GET|POST|PUT|PATCH|DELETE)$/.test(name)) routes.set(`${name} ${path}`, true);
      }
    }
  }
  return routes;
}

const documented = GROUPS.flatMap((g) => g.endpoints);
const key = (e: { method: string; path: string }) => `${e.method} ${e.path}`;

describe("the API reference", () => {
  const inCode = routesInCode();

  test("finds the route files at all", () => {
    assert.ok(inCode.size > 50, `only ${inCode.size} routes found under ${API_DIR}`);
  });

  test("documents every route handler, and nothing else", () => {
    const docKeys = new Set(documented.map(key));
    const missing = [...inCode.keys()].filter((k) => !docKeys.has(k)).sort();
    const extra = [...docKeys].filter((k) => !inCode.has(k)).sort();
    assert.deepEqual({ missing, extra }, { missing: [], extra: [] });
  });

  test("documents each route once", () => {
    const seen = new Map<string, number>();
    for (const e of documented) seen.set(key(e), (seen.get(key(e)) ?? 0) + 1);
    assert.deepEqual([...seen].filter(([, n]) => n > 1), []);
  });

  test("says session-only exactly where the handler calls auth() itself", () => {
    // Internal routes check their own OIDC or are Auth.js; neither takes a token.
    const wrong = documented
      .filter((e) => e.access !== "internal")
      .filter((e) => inCode.has(key(e)) && inCode.get(key(e)) !== e.token)
      .map((e) => `${key(e)}: documented token=${e.token}, code takes a token=${inCode.get(key(e))}`);
    assert.deepEqual(wrong, []);
  });

  test("gives every endpoint a distinct anchor, and every group a distinct id", () => {
    const anchors = documented.map(endpointAnchor);
    assert.equal(new Set(anchors).size, anchors.length);
    const ids = GROUPS.map((g) => g.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(ids.every((id) => !anchors.includes(id)));
  });

  test("never says an internal route takes a token", () => {
    assert.deepEqual(
      documented.filter((e) => e.access === "internal" && e.token).map(key),
      [],
    );
  });

  test("uses only access levels it can label", () => {
    assert.deepEqual(
      documented.filter((e) => !(e.access in ACCESS_LABELS)).map(key),
      [],
    );
  });
});
