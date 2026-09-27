/**
 * Every role, against the production build, over HTTP.
 *
 * The unit and database suites prove the rules; this proves the rules are the
 * ones the pages and routes actually apply. `auth()` only works inside a Next
 * request, so the check each page and route makes can only be seen from the
 * outside: sign in as each persona (a session row plus its cookie — the same
 * thing Google sign-in leaves behind), ask for everything, and compare what
 * comes back with what the roles say should.
 *
 * Nothing here changes anything that matters. An allowed request is sent a
 * body its route rejects, or an id that does not exist, so passing the gate is
 * proven by getting past 401/403 and no further. The one route that would act
 * on anything real — restoring a backup — is only ever asked by people who
 * must be refused.
 *
 * Run it after `npm run build`: `npm run test:e2e`. It starts the standalone
 * server on port 3100 (E2E_PORT) against the scratch database, and stops it.
 */

import "../support/test-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { mintToken } from "@/lib/api-tokens";
import { NAV_SECTIONS, visibleSections } from "@/lib/nav";
import {
  canAuditProjects,
  canContributeComponents,
  canCreateEvents,
  canManageBackups,
  canManageLabGuides,
  canManageSchedulerSettings,
  canManageSettings,
  canManageSignInDomains,
  canManageUsers,
  canPublishComponents,
  canRunSql,
  canSeeAllEvents,
  canUseEvents,
  canUseScheduler,
  homePath,
  type Access,
} from "@/lib/roles";
import { visibleSettingsTabs } from "@/app/(app)/settings/tabs";
import { PERSONAS, PERSONA_NAMES, type Persona } from "../support/access";
import { createRun, createSession, readRoles, testScope, type TestUser } from "../support/seed";
import { E2E_BOOTSTRAP_EMAILS, startServer, type Server } from "./server";

const scope = testScope("e2e");

/** An id no row has, so an allowed request finds nothing to act on. */
const MISSING = "00000000-0000-4000-8000-000000000000";
const SIGNED_OUT = null;
type Who = Persona | typeof SIGNED_OUT;

let server: Server;
const people = {} as Record<Persona, TestUser>;
const cookies = {} as Record<Persona, string>;
const ownRun = {} as Record<Persona, string>;
let aliceRun: string;

before(async () => {
  await scope.setUp();
  server = await startServer(process.env.DATABASE_URL!);

  const alice = await scope.createUser("alice", PERSONAS.operator);
  aliceRun = await createRun(alice.id, "Alice's workshop");
  for (const p of PERSONA_NAMES) {
    people[p] = await scope.createUser(p, PERSONAS[p]);
    cookies[p] = await createSession(people[p].id);
    ownRun[p] = await createRun(people[p].id, `${p}'s workshop`);
  }
});

after(async () => {
  await server?.stop();
  await scope.tearDown();
});

type Sent = { status: number; location: string | null; body: string };

async function send(
  who: Who | { cookie?: string; bearer?: string },
  method: string,
  path: string,
  body?: unknown,
): Promise<Sent> {
  const headers: Record<string, string> = {};
  const as = typeof who === "string" ? { cookie: cookies[who] } : (who ?? {});
  if (as.cookie) headers.cookie = `authjs.session-token=${as.cookie}`;
  if (as.bearer) headers.authorization = `Bearer ${as.bearer}`;

  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    payload = JSON.stringify(body);
    headers["content-type"] = "application/json";
  }

  const res = await fetch(`${server.baseUrl}${path}`, {
    method,
    headers,
    body: payload,
    redirect: "manual",
  });
  const location = res.headers.get("location");
  return {
    status: res.status,
    location: location && new URL(location, server.baseUrl).pathname,
    body: await res.text(),
  };
}

const label = (who: Who) => who ?? "signed out";
const isRedirect = (s: number) => s === 303 || s === 307 || s === 308;

// ─── Pages ──────────────────────────────────────────────────────────────────

/** What a page should do for someone: render, not exist, or send them on. */
type PageOutcome = 200 | 404 | { to: string };

function describeOutcome(o: PageOutcome) {
  return typeof o === "number" ? String(o) : `→ ${o.to}`;
}

function outcomeOf(sent: Sent): PageOutcome | string {
  if (sent.status === 200 || sent.status === 404) return sent.status;
  if (isRedirect(sent.status) && sent.location) return { to: sent.location };
  return `status ${sent.status}`;
}

const gated =
  (can: (a: Access) => boolean): ((a: Access) => PageOutcome) =>
  (a) =>
    can(a) ? 200 : 404;

type PageCase = {
  path: () => string;
  /** How a signed-in persona is treated. */
  expect: (a: Access) => PageOutcome;
  /** Pages outside the signed-in shell answer signed-out visitors themselves. */
  signedOut?: PageOutcome;
};

const PAGES: Record<string, PageCase> = {
  "/": { path: () => "/", expect: () => ({ to: "/events" }), signedOut: 200 },
  "/events": {
    path: () => "/events",
    expect: (a) => (canUseEvents(a) ? 200 : { to: homePath(a) }),
  },
  "/runs/<own event>": { path: () => "/runs/:own", expect: gated(canUseEvents) },
  "/runs/<someone else's>": { path: () => `/runs/${aliceRun}`, expect: gated(canSeeAllEvents) },
  "/contribute": { path: () => "/contribute", expect: gated(canUseEvents) },
  "/scheduler": { path: () => "/scheduler", expect: gated(canUseScheduler) },
  "/scheduler-settings": {
    path: () => "/scheduler-settings",
    expect: gated(canManageSchedulerSettings),
  },
  "/welcome": {
    path: () => "/welcome",
    expect: (a) => (homePath(a) === "/welcome" ? 200 : { to: homePath(a) }),
  },
  "/users": { path: () => "/users", expect: gated(canManageUsers) },
  "/backups": { path: () => "/backups", expect: gated(canManageBackups) },
  "/database": { path: () => "/database", expect: gated(canRunSql) },
  "/cloud-status": { path: () => "/cloud-status", expect: gated(canAuditProjects) },
  "/settings": {
    path: () => "/settings",
    expect: (a) => (canManageSettings(a) ? { to: visibleSettingsTabs(a)[0]!.href } : 404),
  },
  "/settings/domains": { path: () => "/settings/domains", expect: gated(canManageSignInDomains) },
  "/settings/org-secrets": { path: () => "/settings/org-secrets", expect: gated(canManageSettings) },
  "/settings/templates": { path: () => "/settings/templates", expect: gated(canManageSettings) },
  "/settings/repos": { path: () => "/settings/repos", expect: gated(canManageSettings) },
  "/me/tokens": { path: () => "/me/tokens", expect: () => 200 },
  "/me/org-secrets": { path: () => "/me/org-secrets", expect: () => 200 },
  "/me/templates": { path: () => "/me/templates", expect: () => 200 },
  "/labs": { path: () => "/labs", expect: () => 200, signedOut: 200 },
  "/labs/new": {
    path: () => "/labs/new",
    expect: gated(canManageLabGuides),
    signedOut: { to: "/signin" },
  },
  "/labs/guides/new": {
    path: () => "/labs/guides/new",
    expect: gated(canManageLabGuides),
    signedOut: { to: "/signin" },
  },
};

describe("pages", () => {
  for (const who of [SIGNED_OUT, ...PERSONA_NAMES] as Who[]) {
    test(label(who), async () => {
      const wrong: string[] = [];
      for (const [name, page] of Object.entries(PAGES)) {
        const path = page.path().replace(":own", who ? ownRun[who] : MISSING);
        const want: PageOutcome =
          who === SIGNED_OUT ? (page.signedOut ?? { to: "/signin" }) : page.expect(PERSONAS[who]);
        const got = outcomeOf(await send(who, "GET", path));
        if (JSON.stringify(got) !== JSON.stringify(want)) {
          wrong.push(`${name}: got ${typeof got === "string" ? got : describeOutcome(got)}, want ${describeOutcome(want)}`);
        }
      }
      assert.deepEqual(wrong, []);
    });
  }
});

describe("the sidebar", () => {
  // Every link the sidebar can hold, and whether this persona's should.
  const HREFS = NAV_SECTIONS.flatMap((s) => s.items.map((i) => i.href));

  for (const p of PERSONA_NAMES) {
    test(p, async () => {
      const { status, body } = await send(p, "GET", "/me/tokens");
      assert.equal(status, 200);
      const shown = new Set(visibleSections(PERSONAS[p]).flatMap((s) => s.items.map((i) => i.href)));
      const wrong = HREFS.filter((href) => body.includes(`href="${href}"`) !== shown.has(href)).map(
        (href) => `${href}: ${shown.has(href) ? "missing" : "shown"}`,
      );
      assert.deepEqual(wrong, []);
    });
  }
});

// ─── API routes ─────────────────────────────────────────────────────────────

type RouteCase = {
  method: string;
  path: string;
  /** Who gets past the gate; `true` is any signed-in account, `"public"` anyone. */
  allowed: ((a: Access) => boolean) | true | "public";
  /** Something the route will reject once past its gate. */
  body?: () => unknown;
  /** Only the refusals are checked: an allowed request would do something real. */
  denyOnly?: boolean;
  /** Past the gate it needs a cloud the test server is not given, and says so. */
  unconfigured?: boolean;
};

const form = () => new FormData();

const ROUTES: RouteCase[] = [
  // Events
  { method: "GET", path: "/api/runs", allowed: canUseEvents },
  { method: "POST", path: "/api/runs", allowed: canCreateEvents, body: () => ({}) },
  { method: "GET", path: "/api/runs/stranded", allowed: canManageBackups },

  // Platform
  { method: "GET", path: "/api/backups", allowed: canManageBackups, unconfigured: true },
  { method: "POST", path: "/api/backups", allowed: canManageBackups, body: () => ({ description: 1 }) },
  { method: "POST", path: `/api/backups/${MISSING}/restore`, allowed: canManageBackups, denyOnly: true },
  { method: "GET", path: "/api/cloud-status", allowed: canAuditProjects },
  { method: "POST", path: "/api/database/query", allowed: canRunSql, body: () => ({}) },
  { method: "POST", path: "/api/settings/domains", allowed: canManageSignInDomains, body: () => ({}) },
  { method: "PATCH", path: `/api/settings/domains/${MISSING}`, allowed: canManageSignInDomains, body: () => ({}) },
  { method: "DELETE", path: `/api/settings/domains/${MISSING}`, allowed: canManageSignInDomains },

  // Event administration
  { method: "GET", path: "/api/settings/org-secrets", allowed: canManageSettings },
  { method: "POST", path: "/api/settings/org-secrets", allowed: canManageSettings, body: form },
  { method: "PATCH", path: `/api/settings/org-secrets/${MISSING}`, allowed: canManageSettings, body: form },
  { method: "DELETE", path: `/api/settings/org-secrets/${MISSING}`, allowed: canManageSettings },
  { method: "GET", path: "/api/settings/templates", allowed: canManageSettings },
  { method: "POST", path: "/api/settings/templates", allowed: canManageSettings, body: () => ({}) },
  { method: "POST", path: "/api/settings/templates/lookup", allowed: canManageSettings, body: () => ({}) },
  { method: "DELETE", path: `/api/settings/templates/${MISSING}`, allowed: canManageSettings },
  { method: "GET", path: "/api/settings/repos", allowed: canManageSettings },
  { method: "POST", path: "/api/settings/repos", allowed: canManageSettings, body: () => ({}) },
  { method: "PATCH", path: `/api/settings/repos/${MISSING}`, allowed: canManageSettings, body: () => ({}) },
  { method: "DELETE", path: `/api/settings/repos/${MISSING}`, allowed: canManageSettings },
  { method: "POST", path: `/api/me/harness-tokens/${MISSING}/deploy`, allowed: canManageSettings, body: () => ({}) },
  { method: "POST", path: `/api/me/harness-tokens/${MISSING}/scrub`, allowed: canManageSettings },

  // Users
  { method: "PATCH", path: `/api/users/${MISSING}`, allowed: canManageUsers, body: () => ({}) },

  // Components
  { method: "GET", path: "/api/component-sets", allowed: canContributeComponents },
  { method: "POST", path: "/api/component-sets", allowed: canContributeComponents, body: () => ({}) },
  { method: "GET", path: `/api/component-sets/${MISSING}`, allowed: canContributeComponents },
  { method: "POST", path: `/api/component-sets/${MISSING}/submit`, allowed: canContributeComponents },
  { method: "POST", path: `/api/component-sets/${MISSING}/approve`, allowed: canPublishComponents },
  { method: "POST", path: "/api/components/validate", allowed: canContributeComponents, body: () => ({}) },
  { method: "GET", path: "/api/components/bundle", allowed: canContributeComponents },

  // Event guides
  { method: "POST", path: "/api/lab-guides", allowed: canManageLabGuides, body: () => ({}) },
  { method: "PATCH", path: `/api/lab-guides/${MISSING}`, allowed: canManageLabGuides, body: () => ({}) },
  { method: "DELETE", path: `/api/lab-guides/${MISSING}`, allowed: canManageLabGuides },
  { method: "GET", path: `/api/lab-guides/${MISSING}/preview`, allowed: canManageLabGuides },
  { method: "POST", path: "/api/lab-guides/preview", allowed: canManageLabGuides, body: () => ({}) },
  { method: "POST", path: "/api/lab-guides/image-refs", allowed: canManageLabGuides, body: () => ({}) },
  { method: "GET", path: "/api/lab-images", allowed: canManageLabGuides },
  { method: "POST", path: "/api/lab-images", allowed: canManageLabGuides, body: form },
  { method: "GET", path: `/api/lab-images/${MISSING}`, allowed: "public" },
  { method: "PATCH", path: `/api/lab-images/${MISSING}`, allowed: canManageLabGuides, body: () => ({}) },
  { method: "DELETE", path: `/api/lab-images/${MISSING}`, allowed: canManageLabGuides },
  { method: "POST", path: "/api/lab-workshops", allowed: canManageLabGuides, body: () => ({}) },
  { method: "PATCH", path: `/api/lab-workshops/${MISSING}`, allowed: canManageLabGuides, body: () => ({}) },
  { method: "DELETE", path: `/api/lab-workshops/${MISSING}`, allowed: canManageLabGuides },
  { method: "POST", path: `/api/lab-workshops/${MISSING}/guides`, allowed: canManageLabGuides, body: () => ({}) },

  // Everyone's own
  { method: "GET", path: "/api/me/org-secrets", allowed: true },
  { method: "GET", path: "/api/me/templates", allowed: true },
  { method: "GET", path: "/api/me/harness-tokens", allowed: true },
  { method: "GET", path: "/api/tokens", allowed: true },
  { method: "POST", path: "/api/tokens", allowed: true, body: () => ({}) },
  { method: "DELETE", path: `/api/tokens/${MISSING}`, allowed: true },
];

function refusal(route: RouteCase, who: Who): 401 | 403 | null {
  if (route.allowed === "public") return null;
  if (who === SIGNED_OUT) return 401;
  if (route.allowed === true) return null;
  return route.allowed(PERSONAS[who]) ? null : 403;
}

describe("API routes", () => {
  for (const who of [SIGNED_OUT, ...PERSONA_NAMES] as Who[]) {
    test(label(who), async () => {
      const wrong: string[] = [];
      for (const route of ROUTES) {
        const want = refusal(route, who);
        if (want === null && route.denyOnly) continue;

        const { status, body } = await send(who, route.method, route.path, route.body?.());
        const name = `${route.method} ${route.path}`;
        if (want !== null && status !== want) {
          wrong.push(`${name}: got ${status}, want ${want}`);
        } else if (want === null && (status === 401 || status === 403)) {
          wrong.push(`${name}: refused with ${status}, want it let through`);
        } else if (status >= 500 && !(route.unconfigured && status === 503)) {
          // Past the gate, but broken: a route that 500s on a rejected body
          // has a bug of its own, and would hide a gate that let it through.
          wrong.push(`${name}: ${status} ${body.slice(0, 200)}`);
        }
      }
      assert.deepEqual(wrong, []);
    });
  }
});

describe("events over the API", () => {
  test("each persona reaches exactly the events their roles cover", async () => {
    const wrong: string[] = [];
    for (const p of PERSONA_NAMES) {
      const a = PERSONAS[p];
      for (const [which, runId, reachable] of [
        ["own", ownRun[p], canUseEvents(a)],
        ["alice's", aliceRun, canSeeAllEvents(a)],
      ] as const) {
        // Asking to end or retry a scheduled event is refused as "not running"
        // once it is found, so any answer but 404 means the lookup reached it.
        for (const [method, suffix] of [
          ["GET", ""],
          ["POST", "/retry"],
          ["POST", "/retry-teardown"],
        ] as const) {
          const { status } = await send(p, method, `/api/runs/${runId}${suffix}`);
          if ((status !== 404) !== reachable || status >= 500 || status === 401 || status === 403) {
            wrong.push(`${p} ${method} ${which}${suffix}: got ${status}, want reachable=${reachable}`);
          }
        }
      }
    }
    assert.deepEqual(wrong, []);
  });

  test("an event nobody has is 404 to everyone, platform administrators included", async () => {
    assert.equal((await send("platform", "GET", `/api/runs/${MISSING}`)).status, 404);
  });
});

describe("personal access tokens", () => {
  let contributorToken: string;
  let nobodyToken: string;

  before(async () => {
    const mint = async (p: Persona) => {
      const result = await mintToken(people[p].id, "e2e");
      assert.ok(result.ok);
      return result.token.token;
    };
    contributorToken = await mint("contributor");
    nobodyToken = await mint("nobody");
  });

  test("stand in for their owner on the routes that take one", async () => {
    assert.equal((await send({ bearer: contributorToken }, "GET", "/api/component-sets")).status, 200);
    const validate = await send({ bearer: contributorToken }, "POST", "/api/components/validate", {});
    assert.ok(![401, 403].includes(validate.status), `validate: ${validate.status}`);
  });

  test("carry their owner's roles, so a token is refused what its owner is", async () => {
    assert.equal((await send({ bearer: nobodyToken }, "GET", "/api/component-sets")).status, 403);
  });

  test("an unknown token is signed out", async () => {
    assert.equal((await send({ bearer: `wo_${"0".repeat(16)}_nope` }, "GET", "/api/component-sets")).status, 401);
  });

  test("are not accepted where only a browser session is", async () => {
    for (const path of ["/api/runs", "/api/tokens", "/api/me/org-secrets"]) {
      assert.equal((await send({ bearer: contributorToken }, "GET", path)).status, 401, path);
    }
  });
});

// ─── Changing roles ─────────────────────────────────────────────────────────

describe("PATCH /api/users/:id", () => {
  const patch = (who: Persona, id: string, body: unknown) =>
    send(who, "PATCH", `/api/users/${id}`, body);

  test("an event administrator sets event roles, and only event roles", async () => {
    const target = await scope.createUser("u_target1", PERSONAS.operator);
    assert.equal((await patch("eventAdmin", target.id, { area: "event", role: "manager" })).status, 200);
    assert.equal((await readRoles(target.id))?.event, "manager");

    assert.equal((await patch("eventAdmin", target.id, { area: "scheduler", role: "viewer" })).status, 403);
    assert.equal((await patch("eventAdmin", target.id, { area: "platform", value: true })).status, 403);
    assert.deepEqual(await readRoles(target.id), { event: "manager", scheduler: null, platform: false });
  });

  test("a scheduler administrator sets scheduler roles, and only scheduler roles", async () => {
    const target = await scope.createUser("u_target2", PERSONAS.operator);
    assert.equal((await patch("schedulerAdmin", target.id, { area: "scheduler", role: "viewer" })).status, 200);
    assert.equal((await patch("schedulerAdmin", target.id, { area: "event", role: "manager" })).status, 403);
    assert.deepEqual(await readRoles(target.id), { event: "operator", scheduler: "viewer", platform: false });
  });

  test("a platform administrator sets anything, on anyone", async () => {
    const target = await scope.createUser("u_target3", PERSONAS.nobody);
    for (const body of [
      { area: "event", role: "administrator" },
      { area: "scheduler", role: "administrator" },
      { area: "platform", value: true },
    ]) {
      assert.equal((await patch("platform", target.id, body)).status, 200, JSON.stringify(body));
    }
    assert.deepEqual(await readRoles(target.id), {
      event: "administrator",
      scheduler: "administrator",
      platform: true,
    });
  });

  test("only a platform administrator touches another one", async () => {
    const target = await scope.createUser("u_target4", PERSONAS.platform);
    assert.equal((await patch("eventAdmin", target.id, { area: "event", role: "none" })).status, 403);
    assert.equal((await patch("schedulerAdmin", target.id, { area: "scheduler", role: null })).status, 403);
    assert.deepEqual(await readRoles(target.id), PERSONAS.platform);
  });

  test("nobody changes their own roles", async () => {
    for (const p of ["eventAdmin", "schedulerAdmin", "platform"] as const) {
      const body = p === "schedulerAdmin" ? { area: "scheduler", role: null } : { area: "event", role: "none" };
      assert.equal((await patch(p, people[p].id, body)).status, 409, p);
      assert.deepEqual(await readRoles(people[p].id), PERSONAS[p]);
    }
  });

  test("a SITE_ADMIN_EMAILS address keeps platform administration", async () => {
    const target = await scope.createUser("u_boot", PERSONAS.platform, E2E_BOOTSTRAP_EMAILS[0]);
    assert.equal((await patch("platform", target.id, { area: "platform", value: false })).status, 409);
    assert.equal((await readRoles(target.id))?.platform, true);
  });

  test("an unknown user is 404, and a malformed change is 400", async () => {
    assert.equal((await patch("platform", MISSING, { area: "event", role: "manager" })).status, 404);
    const target = await scope.createUser("u_target5", PERSONAS.operator);
    for (const body of [{ area: "event", role: "owner" }, { area: "platform" }, { role: "manager" }, null]) {
      assert.equal((await patch("platform", target.id, body)).status, 400, JSON.stringify(body));
    }
  });
});

describe("a session carries the roles as they are now", () => {
  test("a demotion takes effect on the next request", async () => {
    const user = await scope.createUser("demote", PERSONAS.operator);
    const cookie = await createSession(user.id);
    assert.equal((await send({ cookie }, "GET", "/events")).status, 200);

    await scope.createUser("demote", PERSONAS.nobody);
    const after = await send({ cookie }, "GET", "/events");
    assert.deepEqual([after.status, after.location], [307, "/welcome"]);
    assert.equal((await send({ cookie }, "GET", "/api/runs")).status, 403);
  });

  test("a SITE_ADMIN_EMAILS address is made a platform administrator when it signs in", async () => {
    const user = await scope.createUser("pending", PERSONAS.nobody, E2E_BOOTSTRAP_EMAILS[1]);
    const cookie = await createSession(user.id);
    assert.equal((await send({ cookie }, "GET", "/database")).status, 200);
    assert.equal((await readRoles(user.id))?.platform, true);
  });

  test("signing in returns to a page on this site, and never to another", async () => {
    const land = async (callbackUrl: string) => {
      const res = await fetch(
        `${server.baseUrl}/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`,
        { headers: { cookie: `authjs.session-token=${cookies.operator}` }, redirect: "manual" },
      );
      assert.ok(isRedirect(res.status), `${callbackUrl}: ${res.status}`);
      const to = new URL(res.headers.get("location")!, server.baseUrl);
      return to.origin === new URL(server.baseUrl).origin ? to.pathname : to.origin;
    };
    assert.equal(await land("/runs"), "/runs");
    for (const evil of ["//evil.example", "/\\evil.example", "/\t/evil.example", "https://evil.example"]) {
      assert.equal(await land(evil), "/events", JSON.stringify(evil));
    }
  });

  test("a signed-out cookie is signed out", async () => {
    const res = await send({ cookie: `wo_test_${randomUUID()}` }, "GET", "/events");
    assert.ok(isRedirect(res.status) && res.location === "/signin", JSON.stringify(res));
  });
});
