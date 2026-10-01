/**
 * The audit trail's coverage and its parts.
 *
 * "Every action is recorded" is held by the first test: a route file that
 * exports a POST, PUT, PATCH or DELETE any way but `audited(...)` fails it,
 * unless the API reference says that handler changes nothing. The rest pin
 * down how a request becomes a row.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { GROUPS } from "@/lib/api-reference";
import { endpointFor, outcomeFor, redact } from "@/lib/audit-shape";
import { listParam, PAGE_SIZE, pageRange, pageWindow, parseListQuery, toPage } from "@/lib/paging";
import { containsPattern } from "@/lib/paging-sql";
import { API_DIR, routeFiles, urlPath } from "../support/routes";

const documented = GROUPS.flatMap((g) => g.endpoints);
const quiet = new Set(
  documented.filter((e) => e.changesNothing).map((e) => `${e.method} ${e.path}`),
);

describe("audit coverage", () => {
  const handlers: { key: string; wrapped: boolean }[] = [];
  for (const file of routeFiles(API_DIR)) {
    const source = readFileSync(file, "utf8");
    const path = urlPath(file);
    for (const m of source.matchAll(/^export (?:const (\w+) = (audited\()?|async function (\w+)\()/gm)) {
      const name = m[1] ?? m[3]!;
      if (!/^(POST|PUT|PATCH|DELETE)$/.test(name)) continue;
      handlers.push({ key: `${name} ${path}`, wrapped: Boolean(m[2]) });
    }
  }

  test("finds the handlers at all", () => {
    assert.ok(handlers.length > 50, `only ${handlers.length} non-GET handlers found`);
  });

  test("wraps every handler that changes something in audited()", () => {
    assert.deepEqual(
      handlers.filter((h) => !h.wrapped && !quiet.has(h.key)).map((h) => h.key),
      [],
    );
  });

  test("leaves a handler the reference says changes nothing unrecorded", () => {
    assert.deepEqual(
      handlers.filter((h) => h.wrapped && quiet.has(h.key)).map((h) => h.key),
      [],
    );
  });

  test("only ever says a POST changes nothing", () => {
    assert.deepEqual(
      documented.filter((e) => e.changesNothing && e.method !== "POST").map((e) => e.path),
      [],
    );
  });

  test("leaves GETs alone: reading is not an action", () => {
    for (const file of routeFiles(API_DIR)) {
      assert.doesNotMatch(readFileSync(file, "utf8"), /^export const GET = audited\(/m, file);
    }
  });
});

describe("endpointFor", () => {
  test("finds the entry for a concrete path", () => {
    assert.equal(endpointFor("PATCH", "/api/users/abc")?.path, "/api/users/{id}");
    assert.equal(endpointFor("POST", "/api/runs/r1/end")?.path, "/api/runs/{id}/end");
  });

  test("prefers a literal segment to a parameter", () => {
    assert.equal(endpointFor("POST", "/api/users/invites")?.path, "/api/users/invites");
    assert.equal(endpointFor("GET", "/api/runs/calendar")?.path, "/api/runs/calendar");
  });

  test("tells methods apart, and ignores a trailing slash", () => {
    assert.equal(endpointFor("DELETE", "/api/runs/r1/")?.method, "DELETE");
    assert.equal(endpointFor("PUT", "/api/users/abc"), null);
  });

  test("matches every documented path to itself", () => {
    for (const e of documented) {
      const concrete = e.path.replace(/\{\.\.\.[^}]+\}/g, "a/b").replace(/\{[^}]+\}/g, "x1");
      assert.equal(endpointFor(e.method, concrete), e, `${e.method} ${e.path}`);
    }
  });
});

describe("redact", () => {
  test("blanks secret-looking keys at any depth", () => {
    assert.deepEqual(
      redact({ name: "ci", token: "pat.abc", nested: { clientSecret: "s", password: "p" } }),
      { name: "ci", token: "[redacted]", nested: { clientSecret: "[redacted]", password: "[redacted]" } },
    );
  });

  test("blanks an org secret's value but keeps a boolean value", () => {
    assert.deepEqual(redact({ value: "hunter2" }), { value: "[redacted]" });
    assert.deepEqual(redact({ area: "platform", value: true }), { area: "platform", value: true });
  });

  test("cuts long strings and long lists short", () => {
    const out = redact({ body: "x".repeat(1000), ids: Array.from({ length: 30 }, (_, i) => i) }) as {
      body: string;
      ids: unknown[];
    };
    assert.match(out.body, /… \(1000 characters\)$/);
    assert.equal(out.ids.length, 26);
    assert.equal(out.ids.at(-1), "… and 5 more");
  });

  test("elides deep nesting", () => {
    assert.deepEqual(redact({ a: { b: { c: { d: { e: 1 } } } } }), { a: { b: { c: { d: "[…]" } } } });
  });
});

test("outcomeFor reads a 403 as denied and other errors as failed", () => {
  assert.equal(outcomeFor(200), "succeeded");
  assert.equal(outcomeFor(204), "succeeded");
  assert.equal(outcomeFor(403), "denied");
  assert.equal(outcomeFor(400), "failed");
  assert.equal(outcomeFor(409), "failed");
  assert.equal(outcomeFor(500), "failed");
});

describe("paging", () => {
  const spec = { sorts: ["at", "actor"] as const, sort: "at" as const, dir: "desc" as const };

  test("falls back to the default for anything missing or unrecognised", () => {
    assert.deepEqual(parseListQuery(undefined, spec), { q: "", sort: "at", dir: "desc", page: 1 });
    assert.deepEqual(
      parseListQuery(new URLSearchParams("sort=nope&dir=up&page=-3"), spec),
      { q: "", sort: "at", dir: "desc", page: 1 },
    );
  });

  test("reads a page's searchParams and a route's URL alike", () => {
    const want = { q: "alice", sort: "actor", dir: "asc", page: 3 };
    assert.deepEqual(parseListQuery({ q: " alice ", sort: "actor", page: "3" }, spec), want);
    assert.deepEqual(parseListQuery(new URLSearchParams("q=alice&sort=actor&dir=asc&page=3"), spec), want);
  });

  test("gives each table on a page its own sort and page, and one shared search", () => {
    assert.equal(listParam("sort", "sales"), "sales.sort");
    assert.equal(listParam("page", "sales"), "sales.page");
    assert.equal(listParam("q", "sales"), "q");
    assert.equal(listParam("sort"), "sort");

    const params = new URLSearchParams("q=eng&sales.sort=actor&sales.dir=asc&sales.page=2&sort=at&page=5");
    assert.deepEqual(parseListQuery(params, spec, "sales"), { q: "eng", sort: "actor", dir: "asc", page: 2 });
    assert.deepEqual(parseListQuery(params, spec, "engineer"), { q: "eng", sort: "at", dir: "desc", page: 1 });
  });

  test("never asks for more than one row past a page", () => {
    assert.deepEqual(pageWindow(1), { limit: PAGE_SIZE + 1, offset: 0 });
    assert.deepEqual(pageWindow(3), { limit: PAGE_SIZE + 1, offset: 2 * PAGE_SIZE });
    assert.equal(parseListQuery({ page: "99999999" }, spec).page, 10_000);
  });

  test("turns the extra row into hasMore, and drops it", () => {
    const full = toPage(Array.from({ length: PAGE_SIZE + 1 }, (_, i) => i), 2);
    assert.equal(full.rows.length, PAGE_SIZE);
    assert.equal(full.hasMore, true);
    assert.deepEqual(pageRange(full), { from: PAGE_SIZE + 1, to: 2 * PAGE_SIZE });

    const last = toPage([1, 2], 1);
    assert.equal(last.hasMore, false);
    assert.deepEqual(pageRange(last), { from: 1, to: 2 });
  });

  test("escapes ILIKE wildcards in a search", () => {
    assert.equal(containsPattern("100%_off\\"), "%100\\%\\_off\\\\%");
  });
});
