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

import { mintToken, revokeToken } from "@/lib/api-tokens";
import { NAV_SECTIONS, visibleSections } from "@/lib/nav";
import {
  canAuditProjects,
  canContributeComponents,
  canCreateEvents,
  canDeleteUsers,
  canImpersonate,
  canManageBackups,
  canManageEvalsSettings,
  canManageIris,
  canManageLabGuides,
  canManageTrainingSettings,
  canManageSettings,
  canManageSignInDomains,
  canManageUsers,
  canPublishComponents,
  canScoreAssessments,
  canSearchEmployees,
  canRefreshCanaryWire,
  canSeeCanaryWire,
  canSeeReporting,
  canSeeAllEvents,
  canTakeIris,
  canUseEvals,
  canUseEvents,
  canUseTraining,
  canViewAuditTrail,
  homePath,
  type Access,
} from "@/lib/roles";
import { visibleCohortSettingsTabs } from "@/app/(app)/cohort-settings/tabs";
import { EVALS_SETTINGS_TABS } from "@/app/(app)/evals-settings/tabs";
import { SCHEDULER_SETTINGS_TABS } from "@/app/(app)/scheduler-settings/tabs";
import { EVALS_TABS } from "@/app/(app)/evals/tabs";
import { visibleReportingTabs } from "@/app/(app)/reporting/tabs";
import { COHORTS_TABS } from "@/app/(app)/cohorts/tabs";
import { visibleSettingsTabs } from "@/app/(app)/settings/tabs";
import { visibleMySettingsTabs } from "@/app/(app)/me/tabs";
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
const tokens = {} as Record<Persona, string>;
const ownRun = {} as Record<Persona, string>;
let aliceRun: string;
let historyId: string;
let assessmentId: string;
let bootcampId: string;

before(async () => {
  await scope.setUp();
  server = await startServer(process.env.DATABASE_URL!);

  const alice = await scope.createUser("alice", PERSONAS.operator);
  aliceRun = await createRun(alice.id, "Alice's workshop");
  historyId = await scope.createHistory("history");
  assessmentId = await scope.createAssessment(alice.id, "e2e assessment");
  // The scoring pages need an active bootcamp.
  bootcampId = await scope.activeBootcamp(alice.id);
  for (const p of PERSONA_NAMES) {
    people[p] = await scope.createUser(p, PERSONAS[p]);
    cookies[p] = await createSession(people[p].id);
    const minted = await mintToken(people[p].id, "e2e matrix");
    assert.ok(minted.ok);
    tokens[p] = minted.token.token;
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
  "/scheduler": { path: () => "/scheduler", expect: gated(canUseTraining) },
  "/scheduler/<a bootcamp>": { path: () => `/scheduler/${bootcampId}`, expect: gated(canUseTraining) },
  "/scheduler/active": { path: () => "/scheduler/active", expect: gated(canUseTraining) },
  "/scheduler/<a bootcamp>/print": { path: () => `/scheduler/${bootcampId}/print?day=1`, expect: gated(canUseTraining) },
  "/scheduler/<a bootcamp>/print?track": { path: () => `/scheduler/${bootcampId}/print?track=btc`, expect: gated(canUseTraining) },
  "/scheduler/<unknown>/print": { path: () => `/scheduler/${MISSING}/print`, expect: () => 404 },
  "/scheduler/<unknown>": { path: () => `/scheduler/${MISSING}`, expect: () => 404 },
  "/scheduler/<not an id>": { path: () => "/scheduler/nonsense", expect: () => 404 },
  "/scheduler-settings": {
    path: () => "/scheduler-settings",
    expect: (a) => (canManageTrainingSettings(a) ? { to: SCHEDULER_SETTINGS_TABS[0]!.href } : 404),
  },
  "/scheduler-settings/facilities": {
    path: () => "/scheduler-settings/facilities",
    expect: gated(canManageTrainingSettings),
  },
  "/scheduler-settings/session-types": {
    path: () => "/scheduler-settings/session-types",
    expect: gated(canManageTrainingSettings),
  },
  "/cohorts": {
    path: () => "/cohorts",
    expect: (a) => (canUseTraining(a) ? { to: COHORTS_TABS[0]!.href } : 404),
  },
  "/cohorts/current": { path: () => "/cohorts/current", expect: gated(canUseTraining) },
  "/cohorts/deferred": { path: () => "/cohorts/deferred", expect: gated(canUseTraining) },
  "/cohorts/name-cards": { path: () => "/cohorts/name-cards", expect: gated(canUseTraining) },
  "/cohorts/previous": { path: () => "/cohorts/previous", expect: gated(canUseTraining) },
  "/cohorts/previous?open=<a day>": { path: () => "/cohorts/previous?open=2026-09-14", expect: gated(canUseTraining) },
  "/cohorts/previous/<a record>": {
    path: () => `/cohorts/previous/${historyId}`,
    expect: gated((a) => canUseTraining(a) && canUseEvals(a)),
  },
  "/cohorts/previous/<unknown>": { path: () => `/cohorts/previous/${MISSING}`, expect: () => 404 },
  "/cohort-settings": {
    path: () => "/cohort-settings",
    expect: (a) => (canManageTrainingSettings(a) ? { to: visibleCohortSettingsTabs(a)[0]!.href } : 404),
  },
  "/cohort-settings/hibob": { path: () => "/cohort-settings/hibob", expect: gated(canManageTrainingSettings) },
  "/cohort-settings/employees": {
    path: () => "/cohort-settings/employees",
    expect: gated(canManageTrainingSettings),
  },
  "/cohort-settings/automation": {
    path: () => "/cohort-settings/automation",
    expect: gated(canManageTrainingSettings),
  },
  "/cohort-settings/organization": {
    path: () => "/cohort-settings/organization",
    expect: gated(canManageTrainingSettings),
  },
  "/cohort-settings/channel-contacts": {
    path: () => "/cohort-settings/channel-contacts",
    expect: gated(canManageTrainingSettings),
  },
  "/cohort-settings/slack": { path: () => "/cohort-settings/slack", expect: gated(canManageTrainingSettings) },
  "/cohort-settings/slack/<unknown>": { path: () => `/cohort-settings/slack/${MISSING}`, expect: () => 404 },
  "/evals": {
    path: () => "/evals",
    expect: (a) => (canScoreAssessments(a) ? { to: EVALS_TABS[0]!.href } : 404),
  },
  "/evals/bootcamp": { path: () => "/evals/bootcamp", expect: gated(canScoreAssessments) },
  "/evals/intermediate": { path: () => "/evals/intermediate", expect: gated(canScoreAssessments) },
  "/evals/<unknown stage>": { path: () => "/evals/nonsense", expect: () => 404 },
  "/evals/bootcamp/<an assessment>": {
    path: () => `/evals/bootcamp/${assessmentId}`,
    expect: gated(canScoreAssessments),
  },
  "/evals/intermediate/<a bootcamp assessment>": {
    path: () => `/evals/intermediate/${assessmentId}`,
    expect: () => 404,
  },
  "/evals/bootcamp/<an assessment>/<not an attendee>": {
    path: () => `/evals/bootcamp/${assessmentId}/0`,
    expect: () => 404,
  },
  "/iris": {
    path: () => "/iris",
    expect: (a) => (canTakeIris(a) ? { to: "/iris/tests" } : 404),
  },
  "/iris/tests": { path: () => "/iris/tests", expect: gated(canTakeIris) },
  "/iris/tests/<a subject>": { path: () => "/iris/tests/sdlc", expect: gated(canTakeIris) },
  "/iris/tests/<a subject>?mode=preview": {
    path: () => "/iris/tests/sdlc?mode=preview",
    expect: gated(canManageIris),
  },
  "/iris/tests/<unknown>": { path: () => "/iris/tests/nonsense", expect: () => 404 },
  "/iris/cohort": { path: () => "/iris/cohort", expect: gated(canManageIris) },
  "/iris/cohort?view=charts": { path: () => "/iris/cohort?view=charts&q=e2e", expect: gated(canManageIris) },
  "/iris/cohort/<a person>": { path: () => `/iris/cohort/${people.irisTaker.id}`, expect: gated(canManageIris) },
  "/iris/cohort/<unknown>": { path: () => `/iris/cohort/${MISSING}`, expect: () => 404 },
  "/iris/questions": { path: () => "/iris/questions", expect: gated(canManageIris) },
  "/iris/questions?subject": { path: () => "/iris/questions?subject=compete&level=3&status=draft", expect: gated(canManageIris) },
  "/reporting": {
    path: () => "/reporting",
    expect: (a) => (canSeeReporting(a) ? { to: visibleReportingTabs(a)[0]!.href } : 404),
  },
  "/reporting/canary-wire": { path: () => "/reporting/canary-wire", expect: gated(canSeeCanaryWire) },
  "/reporting/bootcamp-history": { path: () => "/reporting/bootcamp-history", expect: gated(canUseEvals) },
  "/reporting/bootcamp-history?status=active": {
    path: () => "/reporting/bootcamp-history?status=active",
    expect: gated(canUseEvals),
  },
  "/reporting/bootcamp-history/<a record>": {
    path: () => `/reporting/bootcamp-history/${historyId}`,
    expect: gated(canUseEvals),
  },
  "/reporting/bootcamp-history/<unknown>": {
    path: () => `/reporting/bootcamp-history/${MISSING}`,
    expect: () => 404,
  },
  // The old path, before Bootcamp History moved under Reporting, redirects for everyone.
  "/bootcamp-history": {
    path: () => "/bootcamp-history",
    expect: () => ({ to: "/reporting/bootcamp-history" }),
    signedOut: { to: "/reporting/bootcamp-history" },
  },
  "/bootcamp-history/<id>": {
    path: () => `/bootcamp-history/${MISSING}`,
    expect: () => ({ to: `/reporting/bootcamp-history/${MISSING}` }),
    signedOut: { to: `/reporting/bootcamp-history/${MISSING}` },
  },
  "/evals-settings": {
    path: () => "/evals-settings",
    expect: (a) => (canManageEvalsSettings(a) ? { to: EVALS_SETTINGS_TABS[0]!.href } : 404),
  },
  "/evals-settings/assessments": {
    path: () => "/evals-settings/assessments",
    expect: gated(canManageEvalsSettings),
  },
  "/evals-settings/assessments/new": {
    path: () => "/evals-settings/assessments/new",
    expect: gated(canManageEvalsSettings),
  },
  "/evals-settings/assessments/<one>": {
    path: () => `/evals-settings/assessments/${assessmentId}`,
    expect: gated(canManageEvalsSettings),
  },
  "/evals-settings/assessments/<unknown>": {
    path: () => `/evals-settings/assessments/${MISSING}`,
    expect: () => 404,
  },
  "/evals-settings/slack-contacts": {
    path: () => "/evals-settings/slack-contacts",
    expect: gated(canManageEvalsSettings),
  },
  "/evals-settings/google-meetings": {
    path: () => "/evals-settings/google-meetings",
    expect: gated(canManageEvalsSettings),
  },
  "/evals-settings/google-meetings?when=past": {
    path: () => "/evals-settings/google-meetings?when=past",
    expect: gated(canManageEvalsSettings),
  },
  "/welcome": {
    path: () => "/welcome",
    expect: (a) => (homePath(a) === "/welcome" ? 200 : { to: homePath(a) }),
  },
  "/users": { path: () => "/users", expect: gated(canManageUsers) },
  "/invite/<unknown>": { path: () => `/invite/${"A".repeat(32)}`, expect: () => 200 },
  "/backups": { path: () => "/backups", expect: gated(canManageBackups) },
  "/cloud-status": { path: () => "/cloud-status", expect: gated(canAuditProjects) },
  "/admin-settings": { path: () => "/admin-settings", expect: gated(canManageSignInDomains) },
  "/audit": { path: () => "/audit", expect: gated(canViewAuditTrail) },
  "/audit?q=nothing&sort=actor&page=2": {
    path: () => "/audit?q=nothing&sort=actor&page=2",
    expect: gated(canViewAuditTrail),
  },
  "/settings": {
    path: () => "/settings",
    expect: (a) => (canManageSettings(a) ? { to: visibleSettingsTabs(a)[0]!.href } : 404),
  },
  "/settings/org-secrets": { path: () => "/settings/org-secrets", expect: gated(canManageSettings) },
  "/settings/templates": { path: () => "/settings/templates", expect: gated(canManageSettings) },
  "/settings/repos": { path: () => "/settings/repos", expect: gated(canManageSettings) },
  "/me": { path: () => "/me", expect: (a) => ({ to: visibleMySettingsTabs(a)[0]!.href }) },
  "/me/tokens": { path: () => "/me/tokens", expect: gated(canUseEvents) },
  "/me/org-secrets": { path: () => "/me/org-secrets", expect: gated(canUseEvents) },
  "/me/templates": { path: () => "/me/templates", expect: gated(canUseEvents) },
  "/me/check-pc": { path: () => "/me/check-pc", expect: () => 200 },
  "/me/api-tokens": { path: () => "/me/api-tokens", expect: () => 200 },
  "/inbox": { path: () => "/inbox", expect: () => 200 },
  "/labs": { path: () => "/labs", expect: () => 200, signedOut: 200 },
  "/api": { path: () => "/api", expect: () => 200, signedOut: 200 },
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
      const { status, body } = await send(p, "GET", "/me/check-pc");
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
  /** Refuses a personal access token, even its owner's; see docs/api.md. */
  sessionOnly?: boolean;
};

const form = () => new FormData();

const ROUTES: RouteCase[] = [
  // Events
  { method: "GET", path: "/api/runs", allowed: canUseEvents },
  { method: "POST", path: "/api/runs", allowed: canCreateEvents, body: () => ({}) },
  { method: "GET", path: "/api/runs/stranded", allowed: canManageBackups },
  { method: "GET", path: "/api/runs/calendar", allowed: canUseEvents },

  // Platform
  { method: "GET", path: "/api/backups", allowed: canManageBackups, unconfigured: true, sessionOnly: true },
  { method: "POST", path: "/api/backups", allowed: canManageBackups, body: () => ({ description: 1 }), sessionOnly: true },
  { method: "POST", path: `/api/backups/${MISSING}/restore`, allowed: canManageBackups, denyOnly: true, sessionOnly: true },
  // The test server is not QA, so past the gate both answer 404.
  { method: "GET", path: "/api/backups/production", allowed: canManageBackups, sessionOnly: true },
  { method: "POST", path: `/api/backups/production/${MISSING}/import`, allowed: canManageBackups, body: () => ({}), sessionOnly: true },
  { method: "GET", path: "/api/cloud-status", allowed: canAuditProjects },
  { method: "GET", path: "/api/audit", allowed: canViewAuditTrail },
  { method: "GET", path: "/api/settings/domains", allowed: canManageSignInDomains },
  { method: "POST", path: "/api/settings/domains", allowed: canManageSignInDomains, body: () => ({}), sessionOnly: true },
  { method: "PATCH", path: `/api/settings/domains/${MISSING}`, allowed: canManageSignInDomains, body: () => ({}), sessionOnly: true },
  { method: "DELETE", path: `/api/settings/domains/${MISSING}`, allowed: canManageSignInDomains, sessionOnly: true },

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

  // Iris
  { method: "GET", path: "/api/iris/me", allowed: canTakeIris },
  { method: "PUT", path: "/api/iris/me/track", allowed: canTakeIris, body: () => ({}) },
  { method: "POST", path: "/api/iris/sittings", allowed: canTakeIris, body: () => ({}) },
  // A taker gets past the gate but not into a preview, which is the console's.
  {
    method: "POST",
    path: "/api/iris/sittings",
    allowed: canManageIris,
    body: () => ({ subject: "sdlc", mode: "preview" }),
    denyOnly: true,
  },
  { method: "GET", path: `/api/iris/sittings/${MISSING}`, allowed: canTakeIris },
  { method: "POST", path: `/api/iris/sittings/${MISSING}/answers`, allowed: canTakeIris, body: () => ({}) },
  { method: "GET", path: "/api/iris/cohort", allowed: canManageIris },
  { method: "GET", path: `/api/iris/cohort/${MISSING}`, allowed: canManageIris },
  { method: "DELETE", path: `/api/iris/cohort/${MISSING}`, allowed: canManageIris },
  { method: "GET", path: "/api/iris/questions?subject=sdlc", allowed: canManageIris },
  { method: "PUT", path: "/api/iris/questions/no-such-item/review", allowed: canManageIris, body: () => ({}) },
  { method: "POST", path: "/api/iris/questions/approve-drafts", allowed: canManageIris, body: () => ({}) },

  // Cohorts
  { method: "GET", path: "/api/cohorts/current", allowed: canUseTraining },
  { method: "GET", path: "/api/cohorts/deferred", allowed: canUseTraining },
  { method: "POST", path: "/api/cohorts/current/track", allowed: canManageTrainingSettings, body: () => ({}) },
  { method: "PUT", path: "/api/cohorts/current/track", allowed: canManageTrainingSettings, body: () => ({}) },
  { method: "GET", path: "/api/cohorts/channel-contacts?kind=sales", allowed: canManageTrainingSettings },
  { method: "POST", path: "/api/cohorts/channel-contacts", allowed: canManageTrainingSettings, body: () => ({}) },
  { method: "DELETE", path: `/api/cohorts/channel-contacts/${MISSING}`, allowed: canManageTrainingSettings },
  { method: "GET", path: "/api/cohorts/slack/sync", allowed: canManageTrainingSettings },
  { method: "POST", path: "/api/cohorts/slack/sync", allowed: canManageTrainingSettings, denyOnly: true },
  { method: "GET", path: `/api/cohorts/slack/sync/${MISSING}`, allowed: canManageTrainingSettings },
  { method: "GET", path: "/api/cohorts/slack/settings", allowed: canManageTrainingSettings },
  { method: "PUT", path: "/api/cohorts/slack/settings", allowed: canManageTrainingSettings, body: () => ({}) },
  { method: "GET", path: "/api/cohorts/slack/installation", allowed: canManageTrainingSettings },
  { method: "DELETE", path: "/api/cohorts/slack/installation", allowed: canManageTrainingSettings, denyOnly: true },
  { method: "GET", path: "/api/cohorts/slack/install", allowed: canManageTrainingSettings, unconfigured: true, sessionOnly: true },
  // The shared OAuth callback, with a connection's state: no Slack app on the e2e server, so 503 past the gate.
  {
    method: "GET",
    path: "/api/auth/callback/google?state=wo.slack.stale&code=x",
    allowed: canManageTrainingSettings,
    unconfigured: true,
    sessionOnly: true,
  },
  { method: "GET", path: "/api/cohorts/previous", allowed: canUseTraining },
  { method: "GET", path: "/api/cohorts/previous/2000-01-01", allowed: canUseTraining },
  { method: "GET", path: "/api/scheduler/bootcamps", allowed: canUseTraining },
  { method: "POST", path: "/api/scheduler/bootcamps", allowed: canManageTrainingSettings, body: () => ({}) },
  { method: "PATCH", path: `/api/scheduler/bootcamps/${MISSING}`, allowed: canManageTrainingSettings, body: () => ({}) },
  { method: "GET", path: `/api/scheduler/bootcamps/${MISSING}`, allowed: canUseTraining },
  { method: "DELETE", path: `/api/scheduler/bootcamps/${MISSING}`, allowed: canManageTrainingSettings },
  { method: "GET", path: `/api/scheduler/bootcamps/${MISSING}/judges`, allowed: canUseTraining },
  { method: "POST", path: `/api/scheduler/bootcamps/${MISSING}/judges`, allowed: canManageTrainingSettings, body: () => ({}) },
  { method: "DELETE", path: `/api/scheduler/bootcamps/${MISSING}/judges/${MISSING}`, allowed: canManageTrainingSettings },
  { method: "GET", path: `/api/scheduler/bootcamps/${MISSING}/schedule`, allowed: canUseTraining },
  { method: "PUT", path: `/api/scheduler/bootcamps/${MISSING}/schedule/layout`, allowed: canManageTrainingSettings, body: () => ({}) },
  { method: "GET", path: `/api/scheduler/bootcamps/${MISSING}/schedule/copy`, allowed: canUseTraining },
  { method: "POST", path: `/api/scheduler/bootcamps/${MISSING}/schedule/copy`, allowed: canManageTrainingSettings, body: () => ({}) },
  {
    method: "GET",
    path: `/api/scheduler/bootcamps/${MISSING}/availability?day=1&start=480&minutes=60`,
    allowed: canUseTraining,
  },
  { method: "POST", path: `/api/scheduler/bootcamps/${MISSING}/sessions`, allowed: canManageTrainingSettings, body: () => ({}) },
  { method: "GET", path: `/api/scheduler/bootcamps/${MISSING}/sessions/${MISSING}`, allowed: canUseTraining },
  {
    method: "PATCH",
    path: `/api/scheduler/bootcamps/${MISSING}/sessions/${MISSING}`,
    allowed: canManageTrainingSettings,
    body: () => ({ minutes: 7 }),
  },
  { method: "DELETE", path: `/api/scheduler/bootcamps/${MISSING}/sessions/${MISSING}`, allowed: canManageTrainingSettings },
  { method: "GET", path: `/api/scheduler/bootcamps/${MISSING}/attendees?track=btc`, allowed: canUseTraining },
  { method: "GET", path: `/api/scheduler/bootcamps/${MISSING}/sessions/${MISSING}/groups`, allowed: canUseTraining },
  {
    method: "PUT",
    path: `/api/scheduler/bootcamps/${MISSING}/sessions/${MISSING}/groups`,
    allowed: canManageTrainingSettings,
    body: () => ({ groups: [] }),
  },
  { method: "GET", path: `/api/scheduler/bootcamps/${MISSING}/sessions/${MISSING}/comments`, allowed: canUseTraining },
  {
    method: "POST",
    path: `/api/scheduler/bootcamps/${MISSING}/sessions/${MISSING}/comments`,
    allowed: canManageTrainingSettings,
    body: () => ({}),
  },
  {
    method: "DELETE",
    path: `/api/scheduler/bootcamps/${MISSING}/sessions/${MISSING}/comments/${MISSING}`,
    allowed: canManageTrainingSettings,
  },
  { method: "GET", path: `/api/scheduler/bootcamps/${MISSING}/checklist`, allowed: canUseTraining },
  { method: "GET", path: `/api/scheduler/bootcamps/${MISSING}/checklist/btc/1`, allowed: canUseTraining },
  {
    method: "POST",
    path: `/api/scheduler/bootcamps/${MISSING}/checklist/btc/1`,
    allowed: canManageTrainingSettings,
    body: () => ({}),
  },
  // An item's owner ticks it with no Training role, so the gate is past the role check.
  { method: "PATCH", path: `/api/scheduler/bootcamps/${MISSING}/checklist/items/${MISSING}`, allowed: true, body: () => ({}) },
  { method: "DELETE", path: `/api/scheduler/bootcamps/${MISSING}/checklist/items/${MISSING}`, allowed: canManageTrainingSettings },
  { method: "GET", path: "/api/scheduler/facilities", allowed: canUseTraining },
  { method: "POST", path: "/api/scheduler/facilities", allowed: canManageTrainingSettings, body: () => ({}) },
  { method: "GET", path: `/api/scheduler/facilities/${MISSING}`, allowed: canUseTraining },
  { method: "PATCH", path: `/api/scheduler/facilities/${MISSING}`, allowed: canManageTrainingSettings, body: () => ({ name: "" }) },
  { method: "DELETE", path: `/api/scheduler/facilities/${MISSING}`, allowed: canManageTrainingSettings },
  { method: "GET", path: "/api/scheduler/session-types", allowed: canUseTraining },
  { method: "POST", path: "/api/scheduler/session-types", allowed: canManageTrainingSettings, body: () => ({}) },
  { method: "PATCH", path: `/api/scheduler/session-types/${MISSING}`, allowed: canManageTrainingSettings, body: () => ({ minutes: 7 }) },
  { method: "DELETE", path: `/api/scheduler/session-types/${MISSING}`, allowed: canManageTrainingSettings },

  // eVals
  { method: "GET", path: "/api/evals/bootcamp-history", allowed: canUseEvals },
  { method: "GET", path: `/api/evals/bootcamp-history/${MISSING}`, allowed: canUseEvals },
  { method: "GET", path: "/api/evals/canary-wire", allowed: canSeeCanaryWire },
  // No Mindtickle key on the e2e server: starting is refused as not_configured, and a step finds no pull.
  { method: "GET", path: "/api/evals/canary-wire/pull", allowed: canSeeCanaryWire },
  { method: "POST", path: "/api/evals/canary-wire/pull", allowed: canRefreshCanaryWire },
  { method: "POST", path: "/api/evals/canary-wire/pull/step", allowed: canRefreshCanaryWire },

  // eVals administration
  { method: "GET", path: "/api/evals/candidate-cutoffs", allowed: canManageEvalsSettings },
  { method: "GET", path: "/api/evals/deferral-days", allowed: canManageEvalsSettings },
  { method: "GET", path: "/api/evals/employees", allowed: canSearchEmployees },
  { method: "GET", path: "/api/evals/hibob/sync", allowed: canManageEvalsSettings },
  { method: "GET", path: "/api/evals/organization", allowed: canManageEvalsSettings },
  { method: "GET", path: "/api/evals/slack-contacts", allowed: canManageEvalsSettings },
  { method: "GET", path: "/api/evals/titles", allowed: canManageEvalsSettings },
  { method: "POST", path: "/api/evals/hibob/sync", allowed: canManageEvalsSettings, denyOnly: true },
  { method: "POST", path: "/api/evals/slack-contacts", allowed: canManageEvalsSettings, body: () => ({}) },
  { method: "POST", path: "/api/evals/titles", allowed: canManageEvalsSettings, body: () => ({}) },
  { method: "PUT", path: "/api/evals/candidate-cutoffs", allowed: canManageEvalsSettings, body: () => ({}) },
  { method: "PUT", path: "/api/evals/deferral-days", allowed: canManageEvalsSettings, body: () => ({}) },
  { method: "PATCH", path: `/api/evals/titles/${MISSING}`, allowed: canManageEvalsSettings, body: () => ({}) },
  { method: "DELETE", path: `/api/evals/titles/${MISSING}`, allowed: canManageEvalsSettings },
  { method: "DELETE", path: `/api/evals/slack-contacts/${MISSING}`, allowed: canManageEvalsSettings },
  { method: "GET", path: "/api/evals/google-meetings", allowed: canManageEvalsSettings },
  { method: "POST", path: "/api/evals/google-meetings", allowed: canManageEvalsSettings, body: () => ({}) },
  { method: "PATCH", path: `/api/evals/google-meetings/${MISSING}`, allowed: canManageEvalsSettings, body: () => ({}) },
  { method: "DELETE", path: `/api/evals/google-meetings/${MISSING}`, allowed: canManageEvalsSettings },
  // An allowed sync would call Google for real, were an account connected.
  { method: "POST", path: "/api/evals/google-meetings/sync", allowed: canManageEvalsSettings, denyOnly: true },
  // A redirect to Google, or 503 without an OAuth client; the callback sends a stale state back to the tab.
  { method: "GET", path: "/api/evals/google-meetings/connect", allowed: canManageEvalsSettings, unconfigured: true, sessionOnly: true },
  // The shared OAuth callback, which sends a stale state back to the tab.
  {
    method: "GET",
    path: "/api/auth/callback/google?state=wo.google-meetings.stale&code=x",
    allowed: canManageEvalsSettings,
    sessionOnly: true,
  },
  { method: "GET", path: "/api/evals/assessments", allowed: canManageEvalsSettings },
  { method: "POST", path: "/api/evals/assessments", allowed: canManageEvalsSettings, body: () => ({}) },
  { method: "GET", path: "/api/evals/assessments/unassigned-breakouts", allowed: canManageEvalsSettings },
  { method: "GET", path: `/api/evals/assessments/${MISSING}`, allowed: canManageEvalsSettings },
  { method: "PUT", path: `/api/evals/assessments/${MISSING}`, allowed: canManageEvalsSettings, body: () => ({}) },
  { method: "DELETE", path: `/api/evals/assessments/${MISSING}`, allowed: canManageEvalsSettings },

  // eVals scoring
  { method: "GET", path: "/api/evals/scoring?stage=bootcamp", allowed: canScoreAssessments },
  { method: "GET", path: `/api/evals/scoring/${MISSING}`, allowed: canScoreAssessments },
  { method: "GET", path: `/api/evals/scoring/${MISSING}/0`, allowed: canScoreAssessments },
  { method: "PUT", path: `/api/evals/scoring/${MISSING}/0`, allowed: canScoreAssessments, body: () => ({}) },
  { method: "POST", path: `/api/evals/scoring/${MISSING}/0/transcripts`, allowed: canScoreAssessments, body: form },

  // Users
  { method: "GET", path: "/api/users", allowed: canManageUsers },
  { method: "PATCH", path: `/api/users/${MISSING}`, allowed: canManageUsers, body: () => ({}), sessionOnly: true },
  { method: "DELETE", path: `/api/users/${MISSING}`, allowed: canDeleteUsers, sessionOnly: true },
  { method: "POST", path: "/api/users/invites", allowed: canManageUsers, body: () => ({}), sessionOnly: true },
  { method: "POST", path: "/api/invites/accept", allowed: true, body: () => ({}), sessionOnly: true },

  // Components
  { method: "GET", path: "/api/components", allowed: canUseEvents },
  { method: "GET", path: "/api/component-sets", allowed: canContributeComponents },
  { method: "POST", path: "/api/component-sets", allowed: canContributeComponents, body: () => ({}) },
  { method: "GET", path: `/api/component-sets/${MISSING}`, allowed: canContributeComponents },
  { method: "POST", path: `/api/component-sets/${MISSING}/submit`, allowed: canContributeComponents },
  { method: "POST", path: `/api/component-sets/${MISSING}/approve`, allowed: canPublishComponents },
  { method: "POST", path: "/api/components/validate", allowed: canContributeComponents, body: () => ({}) },

  // Event guides
  { method: "GET", path: "/api/lab-guides", allowed: "public" },
  { method: "GET", path: `/api/lab-guides/${MISSING}`, allowed: "public" },
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
  { method: "GET", path: "/api/lab-workshops", allowed: "public" },
  { method: "GET", path: `/api/lab-workshops/${MISSING}`, allowed: "public" },
  { method: "POST", path: "/api/lab-workshops", allowed: canManageLabGuides, body: () => ({}) },
  { method: "PATCH", path: `/api/lab-workshops/${MISSING}`, allowed: canManageLabGuides, body: () => ({}) },
  { method: "DELETE", path: `/api/lab-workshops/${MISSING}`, allowed: canManageLabGuides },
  { method: "POST", path: `/api/lab-workshops/${MISSING}/guides`, allowed: canManageLabGuides, body: () => ({}) },

  // Everyone's own
  { method: "GET", path: "/api/me", allowed: true },
  { method: "PATCH", path: "/api/me", allowed: true, body: () => ({ themePreference: "bogus" }) },
  { method: "GET", path: "/api/me/impersonation", allowed: true, sessionOnly: true },
  { method: "POST", path: "/api/me/impersonation", allowed: canImpersonate, body: () => ({}), sessionOnly: true },
  // Nobody here is impersonating anyone, so ending it changes nothing.
  { method: "DELETE", path: "/api/me/impersonation", allowed: true, sessionOnly: true },
  { method: "GET", path: "/api/me/org-secrets", allowed: true },
  { method: "GET", path: "/api/me/templates", allowed: true },
  { method: "GET", path: "/api/me/harness-tokens", allowed: true },
  { method: "GET", path: "/api/me/checklist", allowed: true },
  { method: "GET", path: "/api/me/mentions", allowed: true },
  { method: "POST", path: "/api/transcription/token", allowed: true, unconfigured: true },
  { method: "POST", path: "/api/transcription/transcribe", allowed: true, body: form },
  { method: "GET", path: "/api/tokens", allowed: true, sessionOnly: true },
  { method: "POST", path: "/api/tokens", allowed: true, body: () => ({}), sessionOnly: true },
  { method: "DELETE", path: `/api/tokens/${MISSING}`, allowed: true, sessionOnly: true },
];

type Via = "session" | "token";

function refusal(route: RouteCase, who: Who, via: Via): 401 | 403 | null {
  if (route.allowed === "public") return null;
  if (who === SIGNED_OUT) return 401;
  if (via === "token" && route.sessionOnly) return 401;
  if (route.allowed === true) return null;
  return route.allowed(PERSONAS[who]) ? null : 403;
}

// Run once as each persona's session and once as their token: a token stands
// in for its owner everywhere except the routes marked session-only.
for (const via of ["session", "token"] as const) describe(`API routes, by ${via}`, () => {
  const callers = via === "session" ? [SIGNED_OUT, ...PERSONA_NAMES] : PERSONA_NAMES;
  for (const who of callers as Who[]) {
    test(label(who), async () => {
      const wrong: string[] = [];
      for (const route of ROUTES) {
        const want = refusal(route, who, via);
        if (want === null && route.denyOnly) continue;

        const as = via === "token" && who ? { bearer: tokens[who] } : who;
        const { status, body } = await send(as, route.method, route.path, route.body?.());
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

describe("the shared OAuth callback", () => {
  // A connection's state goes to the connection; anything else is Auth.js's
  // sign-in, which must behave for everyone exactly as it did before.
  test("leaves a sign-in state to Auth.js, signed in or not", async () => {
    const wrong: string[] = [];
    for (const who of [SIGNED_OUT, ...PERSONA_NAMES] as Who[]) {
      const { status, location } = await send(who, "GET", "/api/auth/callback/google?state=eyJhbGciOiJkaXIifQ.x&code=x");
      if (status < 300 || status >= 400 || location?.startsWith("/evals-settings") || location?.startsWith("/cohort-settings")) {
        wrong.push(`${label(who)}: got ${status} → ${location}`);
      }
    }
    assert.deepEqual(wrong, []);
  });

  test("sends a connection back to the page that started it, and refuses a purpose it does not know", async () => {
    const back = await send("assessmentsAdmin", "GET", "/api/auth/callback/google?state=wo.google-meetings.stale&code=x");
    assert.deepEqual([back.status, back.location], [307, "/evals-settings/google-meetings"]);
    const unknown = await send("platform", "GET", "/api/auth/callback/google?state=wo.nothing.x&code=x");
    assert.equal(unknown.status, 400);
  });
});

describe("the scheduled HiBob sync", () => {
  // Cloud Scheduler's OIDC token is the only way in: no session, and no token
  // that is not Google's, gets past it.
  test("refuses every session and a forged token", async () => {
    const wrong: string[] = [];
    const forged = { bearer: "not-a-google-token" };
    for (const who of [SIGNED_OUT, ...PERSONA_NAMES, forged]) {
      const { status } = await send(who, "POST", "/api/evals/hibob/sync/scheduled");
      if (status !== 401) wrong.push(`${who === forged ? "forged token" : label(who as Who)}: got ${status}`);
    }
    assert.deepEqual(wrong, []);
  });
});

describe("the scheduled Canary Wire pull", () => {
  test("refuses every session and a forged token", async () => {
    const wrong: string[] = [];
    const forged = { bearer: "not-a-google-token" };
    for (const who of [SIGNED_OUT, ...PERSONA_NAMES, forged]) {
      const { status } = await send(who, "POST", "/api/evals/canary-wire/pull/scheduled");
      if (status !== 401) wrong.push(`${who === forged ? "forged token" : label(who as Who)}: got ${status}`);
    }
    assert.deepEqual(wrong, []);
  });
});

describe("the production import's finish step", () => {
  // Called by QA's import job with runner-sa's OIDC token, after the restore
  // has emptied the sessions table. Nothing else gets past it.
  test("refuses every session and a forged token", async () => {
    const wrong: string[] = [];
    const forged = { bearer: "not-a-google-token" };
    for (const who of [SIGNED_OUT, ...PERSONA_NAMES, forged]) {
      const { status } = await send(who, "POST", "/api/backups/production/finish", {});
      if (status !== 401) wrong.push(`${who === forged ? "forged token" : label(who as Who)}: got ${status}`);
    }
    assert.deepEqual(wrong, []);
  });
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
    for (const [method, path] of [
      ["GET", "/api/tokens"],
      ["POST", "/api/tokens"],
      ["POST", "/api/backups"],
    ]) {
      const { status } = await send({ bearer: contributorToken }, method!, path!, method === "GET" ? undefined : {});
      assert.equal(status, 401, `${method} ${path}`);
    }
  });

  test("a revoked token is signed out at once", async () => {
    const minted = await mintToken(people.operator.id, "e2e revoke");
    assert.ok(minted.ok);
    const bearer = { bearer: minted.token.token };
    assert.equal((await send(bearer, "GET", "/api/runs")).status, 200);
    await revokeToken(people.operator.id, minted.token.id);
    assert.equal((await send(bearer, "GET", "/api/runs")).status, 401);
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

    assert.equal((await patch("eventAdmin", target.id, { area: "training", role: "viewer" })).status, 403);
    assert.equal((await patch("eventAdmin", target.id, { area: "platform", value: true })).status, 403);
    assert.deepEqual(await readRoles(target.id), {
      event: "manager",
      training: null,
      assessments: null,
      iris: null,
      platform: false,
      judging: false,
      manager: false,
    });
  });

  test("a training administrator sets training roles, and only training roles", async () => {
    const target = await scope.createUser("u_target2", PERSONAS.operator);
    assert.equal((await patch("trainingAdmin", target.id, { area: "training", role: "viewer" })).status, 200);
    assert.equal((await patch("trainingAdmin", target.id, { area: "event", role: "manager" })).status, 403);
    assert.equal((await patch("trainingAdmin", target.id, { area: "assessments", role: "viewer" })).status, 403);
    assert.deepEqual(await readRoles(target.id), {
      event: "operator",
      training: "viewer",
      assessments: null,
      iris: null,
      platform: false,
      judging: false,
      manager: false,
    });
  });

  test("an eVals administrator sets eVals roles, and only eVals roles", async () => {
    const target = await scope.createUser("u_target6", PERSONAS.operator);
    assert.equal((await patch("assessmentsAdmin", target.id, { area: "assessments", role: "viewer" })).status, 200);
    assert.equal((await patch("assessmentsAdmin", target.id, { area: "event", role: "manager" })).status, 403);
    assert.equal((await patch("assessmentsAdmin", target.id, { area: "training", role: "viewer" })).status, 403);
    assert.deepEqual(await readRoles(target.id), {
      event: "operator",
      training: null,
      assessments: "viewer",
      iris: null,
      platform: false,
      judging: false,
      manager: false,
    });
  });

  test("an Iris administrator sets Iris roles, and only Iris roles", async () => {
    const target = await scope.createUser("u_target7", PERSONAS.operator);
    assert.equal((await patch("irisAdmin", target.id, { area: "iris", role: "taker" })).status, 200);
    assert.equal((await patch("irisAdmin", target.id, { area: "assessments", role: "viewer" })).status, 403);
    assert.equal((await patch("irisAdmin", target.id, { area: "event", role: "manager" })).status, 403);
    assert.equal((await patch("assessmentsAdmin", target.id, { area: "iris", role: "administrator" })).status, 403);
    assert.deepEqual(await readRoles(target.id), {
      event: "operator",
      training: null,
      assessments: null,
      iris: "taker",
      platform: false,
      judging: false,
      manager: false,
    });
  });

  test("a platform administrator sets anything, on anyone", async () => {
    const target = await scope.createUser("u_target3", PERSONAS.nobody);
    for (const body of [
      { area: "event", role: "administrator" },
      { area: "training", role: "administrator" },
      { area: "assessments", role: "administrator" },
      { area: "iris", role: "administrator" },
      { area: "platform", value: true },
    ]) {
      assert.equal((await patch("platform", target.id, body)).status, 200, JSON.stringify(body));
    }
    assert.deepEqual(await readRoles(target.id), {
      event: "administrator",
      training: "administrator",
      assessments: "administrator",
      iris: "administrator",
      platform: true,
      judging: false,
      manager: false,
    });
  });

  test("only a platform administrator touches another one", async () => {
    const target = await scope.createUser("u_target4", PERSONAS.platform);
    assert.equal((await patch("eventAdmin", target.id, { area: "event", role: "none" })).status, 403);
    assert.equal((await patch("trainingAdmin", target.id, { area: "training", role: null })).status, 403);
    assert.equal((await patch("assessmentsAdmin", target.id, { area: "assessments", role: null })).status, 403);
    assert.equal((await patch("irisAdmin", target.id, { area: "iris", role: null })).status, 403);
    assert.deepEqual(await readRoles(target.id), PERSONAS.platform);
  });

  test("nobody changes their own roles", async () => {
    for (const p of ["eventAdmin", "trainingAdmin", "assessmentsAdmin", "irisAdmin", "platform"] as const) {
      const body =
        p === "trainingAdmin"
          ? { area: "training", role: null }
          : p === "assessmentsAdmin"
            ? { area: "assessments", role: null }
            : p === "irisAdmin"
              ? { area: "iris", role: null }
              : { area: "event", role: "none" };
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
    for (const body of [
      { area: "event", role: "owner" },
      { area: "assessments", role: "manager" },
      { area: "iris", role: "viewer" },
      { area: "platform" },
      { role: "manager" },
      null,
    ]) {
      assert.equal((await patch("platform", target.id, body)).status, 400, JSON.stringify(body));
    }
  });
});

describe("an Iris sitting, over HTTP", () => {
  // Grading is on the server, and only an Iris administrator is told the level.
  async function sit(who: Persona) {
    assert.equal((await send(who, "PUT", "/api/iris/me/track", { track: "AE" })).status, 200);
    const started = await send(who, "POST", "/api/iris/sittings", { subject: "pipegen" });
    assert.equal(started.status, 201, started.body);
    let sitting = JSON.parse(started.body).sitting as { attemptId: string; number: number; question: object };
    for (let guard = 0; guard < 20; guard++) {
      assert.deepEqual(Object.keys(sitting.question).sort(), ["options", "stem"], "no id, answer or level is sent");
      const res = await send(who, "POST", `/api/iris/sittings/${sitting.attemptId}/answers`, {
        number: sitting.number,
        choice: -1,
      });
      assert.equal(res.status, 200, res.body);
      assert.doesNotMatch(res.body, /-l[123]-|"level"|"answer"/, "nothing sent spells a question's level");
      const body = JSON.parse(res.body);
      if (body.done) return body as Record<string, unknown>;
      sitting = body.sitting;
    }
    throw new Error("the sitting never finished");
  }

  const pipegen = async (who: Persona) =>
    (JSON.parse((await send(who, "GET", "/api/iris/me")).body).subjects as { key: string; placement?: number }[]).find(
      (s) => s.key === "pipegen",
    );

  test("a taker is told the sitting is over, never their level", async () => {
    assert.equal((await send("irisAdmin", "POST", "/api/iris/questions/approve-drafts", { subject: "pipegen" })).status, 200);
    const done = await sit("irisTaker");
    assert.ok(!("placement" in done) && !("confidence" in done), JSON.stringify(done));
    assert.ok(!("placement" in (await pipegen("irisTaker"))!));
  });

  test("an Iris administrator sees their own level", async () => {
    const done = await sit("irisAdmin");
    assert.equal(done.placement, 1, "\"I don't know\" throughout places Beginner");
    assert.equal((await pipegen("irisAdmin"))?.placement, 1);
  });
});

describe("invite links", () => {
  const create = (who: Persona, grant: unknown) => send(who, "POST", "/api/users/invites", grant);
  const accept = (cookie: string, token: string) =>
    send({ cookie }, "POST", "/api/invites/accept", { token });

  async function link(who: Persona, grant: unknown) {
    const res = await create(who, grant);
    assert.equal(res.status, 201, res.body);
    const { path } = JSON.parse(res.body) as { path: string };
    assert.match(path, /^\/invite\/[A-Za-z0-9_-]{32}$/);
    return path;
  }

  test("someone with no access signs in, opens the link, and gets its roles", async () => {
    const path = await link("eventAdmin", { eventRole: "manager", trainingRole: null });
    const newcomer = await scope.createUser("inv_newcomer", PERSONAS.nobody);
    const cookie = await createSession(newcomer.id);

    const page = await send({ cookie }, "GET", path);
    assert.equal(page.status, 200);
    assert.deepEqual(await readRoles(newcomer.id), PERSONAS.nobody, "opening the page grants nothing");

    const res = await accept(cookie, path.split("/").pop()!);
    assert.equal(res.status, 200, res.body);
    assert.deepEqual(JSON.parse(res.body), { applied: true, home: "/events" });
    assert.deepEqual(await readRoles(newcomer.id), {
      event: "manager",
      training: null,
      assessments: null,
      iris: null,
      platform: false,
      judging: false,
      manager: false,
    });
    assert.equal((await send({ cookie }, "GET", "/events")).status, 200);
  });

  test("signed out, the link goes through sign-in and back", async () => {
    const path = await link("eventAdmin", { eventRole: "operator", trainingRole: null });
    const res = await fetch(`${server.baseUrl}${path}`, { redirect: "manual" });
    assert.ok(isRedirect(res.status), String(res.status));
    const to = new URL(res.headers.get("location")!, server.baseUrl);
    assert.equal(to.pathname, "/signin");
    assert.equal(to.searchParams.get("callbackUrl"), path);
  });

  test("someone who already has access keeps what they have", async () => {
    const path = await link("platform", { eventRole: "administrator", trainingRole: "administrator" });
    const res = await accept(cookies.operator, path.split("/").pop()!);
    assert.equal(res.status, 200, res.body);
    assert.equal(JSON.parse(res.body).applied, false);
    assert.deepEqual(await readRoles(people.operator.id), PERSONAS.operator);
  });

  test("an administrator links only the areas they administer", async () => {
    assert.equal((await create("trainingAdmin", { eventRole: "operator", trainingRole: null })).status, 403);
    assert.equal((await create("eventAdmin", { eventRole: null, trainingRole: "viewer" })).status, 403);
    assert.equal((await create("trainingAdmin", { eventRole: null, trainingRole: "viewer" })).status, 201);
    assert.equal(
      (await create("trainingAdmin", { eventRole: null, trainingRole: null, assessmentsRole: "viewer" })).status,
      403,
    );
    assert.equal(
      (await create("assessmentsAdmin", { eventRole: null, trainingRole: null, assessmentsRole: "viewer" })).status,
      201,
    );
  });

  test("an eVals link lands its newcomer on eVals", async () => {
    const path = await link("assessmentsAdmin", { eventRole: null, trainingRole: null, assessmentsRole: "viewer" });
    const newcomer = await scope.createUser("inv_evals", PERSONAS.nobody);
    const cookie = await createSession(newcomer.id);
    const res = await accept(cookie, path.split("/").pop()!);
    assert.equal(res.status, 200, res.body);
    assert.deepEqual(JSON.parse(res.body), { applied: true, home: "/evals" });
    assert.equal((await readRoles(newcomer.id))?.assessments, "viewer");
    assert.equal((await send({ cookie }, "GET", EVALS_TABS[0]!.href)).status, 200);
  });

  test("an Iris link lands its newcomer on Iris", async () => {
    const path = await link("irisAdmin", { eventRole: null, trainingRole: null, irisRole: "taker" });
    const newcomer = await scope.createUser("inv_iris", PERSONAS.nobody);
    const cookie = await createSession(newcomer.id);
    const res = await accept(cookie, path.split("/").pop()!);
    assert.equal(res.status, 200, res.body);
    assert.deepEqual(JSON.parse(res.body), { applied: true, home: "/iris" });
    assert.equal((await readRoles(newcomer.id))?.iris, "taker");
    assert.equal((await send({ cookie }, "GET", "/iris/tests")).status, 200);
  });

  test("a link that grants nothing, or platform administration, is not made", async () => {
    for (const body of [
      { eventRole: "none", trainingRole: null },
      { eventRole: null, trainingRole: null },
      { eventRole: null, trainingRole: null, assessmentsRole: null },
      { eventRole: null, trainingRole: null, assessmentsRole: null, irisRole: null },
      { eventRole: "operator", trainingRole: null, platform: true },
    ]) {
      const res = await create("platform", body);
      if ("platform" in body) {
        // An unknown key is dropped, never honoured: the link grants the rest.
        const token = JSON.parse(res.body).path.split("/").pop();
        const newcomer = await scope.createUser("inv_plat", PERSONAS.nobody);
        await accept(await createSession(newcomer.id), token);
        assert.equal((await readRoles(newcomer.id))?.platform, false);
      } else {
        assert.equal(res.status, 400, JSON.stringify(body));
      }
    }
  });

  test("an unknown link is 404", async () => {
    assert.equal((await accept(cookies.nobody, "A".repeat(32))).status, 404);
  });
});

describe("the audit trail", () => {
  /** Rows the matrix wrote are the platform persona's too; a marker finds only this test's. */
  async function find(marker: string) {
    const res = await send("platform", "GET", `/api/audit?q=${marker}`);
    assert.equal(res.status, 200, res.body);
    return JSON.parse(res.body) as {
      events: { actorId: string | null; via: string; action: string; outcome: string; status: number; detail: { body?: Record<string, unknown>; error?: string } | null }[];
      page: number;
      hasMore: boolean;
    };
  }

  test("records a change, a refusal and a failure, with secrets redacted, and not a 401", async () => {
    const marker = `wo_test_audit_${randomUUID().slice(0, 8)}`;
    const body = { title: 1, list: "nope", domain: 1, note: marker, password: "hunter2" };
    assert.equal((await send({ bearer: tokens.platform }, "POST", "/api/evals/titles", body)).status, 400);
    assert.equal((await send("nobody", "POST", "/api/evals/titles", body)).status, 403);
    assert.equal((await send(SIGNED_OUT, "POST", "/api/evals/titles", body)).status, 401);
    // Session-only: it calls auth() itself, so the wrapper has to find the caller afterwards.
    assert.equal((await send("platform", "POST", "/api/settings/domains", body)).status, 400);

    const { events, page, hasMore } = await find(marker);
    assert.deepEqual([page, hasMore], [1, false]);
    assert.deepEqual(
      events.map((e) => [e.via, e.action, e.outcome, e.status]).sort(),
      [
        ["session", "POST /api/evals/titles", "denied", 403],
        ["session", "POST /api/settings/domains", "failed", 400],
        ["token", "POST /api/evals/titles", "failed", 400],
      ],
    );
    for (const e of events) {
      assert.equal(e.detail?.body?.password, "[redacted]");
      assert.equal(e.detail?.body?.note, marker);
    }
    assert.ok(events.every((e) => e.actorId), "every row names its account");
  });

  test("a read-only POST and a GET leave nothing behind", async () => {
    const marker = `wo_test_audit_${randomUUID().slice(0, 8)}`;
    await send("platform", "POST", "/api/components/validate", { note: marker });
    await send("platform", "GET", `/api/runs?note=${marker}`);
    assert.deepEqual((await find(marker)).events, []);
  });

  test("pages at 100 and sorts on any column", async () => {
    for (const sort of ["at", "actor", "action", "target", "outcome"]) {
      for (const dir of ["asc", "desc"]) {
        const res = await send("platform", "GET", `/api/audit?sort=${sort}&dir=${dir}&page=2`);
        assert.equal(res.status, 200, `${sort} ${dir}: ${res.body}`);
        const { events, page } = JSON.parse(res.body);
        assert.equal(page, 2);
        assert.ok(events.length <= 100);
      }
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
    assert.equal((await send({ cookie }, "GET", "/backups")).status, 200);
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

describe("viewing the app as an employee", () => {
  const start = (cookie: string, email: string) => send({ cookie }, "POST", "/api/me/impersonation", { email });
  const stop = (cookie: string) => send({ cookie }, "DELETE", "/api/me/impersonation");
  const me = async (cookie: string) => JSON.parse((await send({ cookie }, "GET", "/api/me")).body) as { id: string; access: Access };

  test("shows the app as the employee, changes nothing, and ends", async () => {
    const admin = await scope.createUser("impersonator", PERSONAS.platform);
    const cookie = await createSession(admin.id);
    const viewed = await scope.createUser("viewed", PERSONAS.operator);
    await scope.createEmployee("viewed", viewed.email);

    assert.equal((await start(cookie, viewed.email.toUpperCase())).status, 200);
    assert.deepEqual(await me(cookie), { ...(await me(cookies.operator)), id: viewed.id, email: viewed.email });
    assert.equal((await send({ cookie }, "GET", "/backups")).status, 404);
    const page = await send({ cookie }, "GET", "/events");
    assert.equal(page.status, 200);
    assert.ok(page.body.includes("Viewing as"), "the header says whom the app is shown as");

    // Nothing is changed in their name, session-only routes included, and the
    // trail says who really asked.
    const marker = `wo_test_imp_${randomUUID().slice(0, 8)}`;
    for (const [method, path, body] of [
      ["PATCH", "/api/me", { themePreference: "dark", note: marker }],
      ["POST", "/api/tokens", { name: marker }],
      ["POST", "/api/runs", { note: marker }],
    ] as const) {
      const res = await send({ cookie }, method, path, body);
      assert.deepEqual([res.status, JSON.parse(res.body).error], [403, "impersonating"], `${method} ${path}`);
    }
    const trail = JSON.parse((await send("platform", "GET", `/api/audit?q=${marker}`)).body) as {
      events: { actorId: string | null; detail: { impersonating?: string } | null }[];
    };
    assert.equal(trail.events.length, 3);
    for (const e of trail.events) assert.deepEqual([e.actorId, e.detail?.impersonating], [admin.id, viewed.email]);

    assert.deepEqual(JSON.parse((await stop(cookie)).body), { impersonating: null, impersonator: null });
    assert.equal((await me(cookie)).id, admin.id);
    assert.equal((await send({ cookie }, "GET", "/backups")).status, 200);
  });

  test("someone who has never signed in is shown as a new account, with the way back", async () => {
    const admin = await scope.createUser("impersonator", PERSONAS.platform);
    const cookie = await createSession(admin.id);
    const email = await scope.createEmployee("newcomer");

    assert.equal((await start(cookie, email)).status, 200);
    const shown = await me(cookie);
    assert.ok(shown.id.startsWith("employee:"), shown.id);
    assert.deepEqual(shown.access, PERSONAS.nobody);
    const events = await send({ cookie }, "GET", "/events");
    assert.deepEqual([events.status, events.location], [307, "/welcome"]);
    const welcome = await send({ cookie }, "GET", "/welcome");
    assert.equal(welcome.status, 200);
    assert.ok(welcome.body.includes("Viewing as"), "the account menu is there to stop it");
    assert.equal((await stop(cookie)).status, 200);
  });

  test("refuses yourself, a platform administrator, and anyone not on the list", async () => {
    const admin = await scope.createUser("impersonator", PERSONAS.platform);
    const cookie = await createSession(admin.id);
    await scope.createEmployee("impersonator", admin.email);
    await scope.createEmployee("platform", people.platform.email);

    for (const [email, status, error] of [
      [admin.email, 409, "self"],
      [people.platform.email, 409, "platform_admin"],
      ["nobody@roles.test", 404, "not_found"],
    ] as const) {
      const res = await start(cookie, email);
      assert.deepEqual([res.status, JSON.parse(res.body).error], [status, error], email);
    }
    assert.equal((await me(cookie)).id, admin.id);
  });

  test("ends the moment the administrator loses the flag", async () => {
    const admin = await scope.createUser("impersonator", PERSONAS.platform);
    const cookie = await createSession(admin.id);
    const email = await scope.createEmployee("newcomer");
    assert.equal((await start(cookie, email)).status, 200);

    await scope.createUser("impersonator", PERSONAS.nobody);
    const after = await me(cookie);
    assert.deepEqual([after.id, after.access], [admin.id, PERSONAS.nobody]);
    await scope.createUser("impersonator", PERSONAS.platform);
    assert.equal((await stop(cookie)).status, 200);
  });
});
