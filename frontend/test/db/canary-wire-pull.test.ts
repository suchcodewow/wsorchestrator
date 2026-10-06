/**
 * A Canary Wire pull from start to saved month, a step at a time, against a
 * stubbed Mindtickle shaped like the live one: rosters and statements that
 * page, continuations handed out on the global host (which 500s for a us
 * tenant, so the stub refuses it), departed staff in the role groups, and a
 * learner in two groups.
 *
 * Each step is given no time, so it does the least a step may — the setup
 * and one learner, or one learner — and the pull is seen to resume from its
 * saved state each time. A pull replaces the stored data, and the scheduler
 * decides by the pulls already there, so both are saved before, set aside,
 * and put back after; pulls this suite made are deleted by id.
 */

import "../support/test-env";

import { after, afterEach, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { eq, inArray } from "drizzle-orm";

import { db, pool } from "@/db";
import { canaryWirePulls, canaryWireSnapshots } from "@/db/schema";
import { advancePull, latestPull, scheduledStep, startPull } from "@/lib/canary-wire/pull";
import { canaryWireView } from "@/lib/canary-wire/store";

const HOST = "https://api.prod-us.mindtickle.com";
const GLOBAL = "https://api.mindtickle.com";
const QUERY_TIME = "2026-09-24T13:10:30.225Z";
const buggyStored = (iso: string) => new Date(Date.parse(iso) / 1000).toISOString();
const st = (moduleId: string, verb: string, at = "") => ({
  verb: { display: { "en-US": verb } },
  object: { id: moduleId },
  timestamp: QUERY_TIME,
  stored: at ? buggyStored(at) : QUERY_TIME,
});
const user = (email: string, userState = "ACTIVE") => ({
  email,
  name: email.split("@")[0],
  userState,
  profile: { dg: "Account Executive", a_0: "ada lovelace" },
  managers: [],
});

const GROUPS = { "Canary Wire - AE and Supporting Roles": "gAE", "Canary Wire - SE": "gSE", "canary wire - sdr": "gSDR" };

/** Path and query → answer. Anything else, including the global host, is refused. */
function mindtickle(url: string, body: unknown): { status: number; json?: unknown } {
  if (url.startsWith(GLOBAL)) return { status: 500 };
  const path = url.slice(HOST.length);
  const ids = (body as { groupIds?: string[] } | undefined)?.groupIds ?? [];
  if (path === "/services/data/auth_token") {
    // As the live API does: the company id alone is not enough.
    if (!(body as { ls_url?: string }).ls_url) return { status: 400, json: { error: "missing parameter ls_url" } };
    return { status: 200, json: { token: "t", expires_in: 3600 } };
  }
  if (path === "/api/v2/series/list") {
    return {
      status: 200,
      json: {
        hits: [
          { id: "sAE", name: "The Canary Wire - AE/Supporting Orgs Edition" },
          { id: "sSE", name: "The Canary Wire - SE Edition" },
          { id: "sSDR", name: "The Canary Wire - SDR Edition" },
          { id: "x", name: "Onboarding" },
        ],
      },
    };
  }
  const modules: Record<string, unknown[]> = {
    sAE: [{ id: "m1", name: "September 2026 - Flex Pricing", moduleType: "UPDATE" }, { id: "m9", name: "September 2026 - Feedback Survey" }],
    sSE: [{ id: "m1", name: "September 2026 - Flex Pricing", moduleType: "UPDATE" }, { id: "m2", name: "September 2026 - Demo Day", moduleType: "ASSESSMENT" }],
    sSDR: [{ id: "m3", name: "September 2026 - Objections", moduleType: "UPDATE" }],
  };
  const series = /^\/api\/v2\/series\/(\w+)\/list$/.exec(path);
  if (series) return { status: 200, json: { hits: modules[series[1]!] ?? [] } };
  if (path === "/services/data/v2.0/mtobjects/Groups") {
    return { status: 200, json: { groups: Object.entries(GROUPS).map(([name, id]) => ({ id, name })) } };
  }
  if (path.startsWith("/services/data/v4.0/mtobjects/Users?cursor=2")) {
    return { status: 200, json: { users: [user("bo@harness.test")], done: true } };
  }
  if (path.startsWith("/services/data/v4.0/mtobjects/Users")) {
    const pages: Record<string, unknown> = {
      gAE: { users: [user("ada@harness.test"), user("gone@harness.test", "DEACTIVATED")], done: false, nextRecordsUrl: `${GLOBAL}/services/data/v4.0/mtobjects/Users?cursor=2` },
      gSE: { users: [user("bo@harness.test"), user("cy@harness.test")], done: true },
      gSDR: { users: [user("dee@harness.test", "ADDED"), user("err@harness.test")], done: true },
    };
    return { status: 200, json: pages[ids[0]!] };
  }
  if (path.startsWith("/services/data/v4.0/xapi/statements")) {
    const q = new URL(url).searchParams;
    if (q.get("more") === "ada-2") return { status: 200, json: { statements: [st("m1", "in_progress", "2026-09-20T10:00:00Z")] } };
    const who = (JSON.parse(q.get("agent")!) as { mbox: string }).mbox.slice("mailto:".length);
    const history: Record<string, { statements: unknown[]; more?: string }> = {
      "ada@harness.test": { statements: [st("m1", "completed", "2026-09-12T10:00:00Z")], more: `${GLOBAL}/services/data/v4.0/xapi/statements?more=ada-2` },
      "bo@harness.test": { statements: [st("m2", "completed", "2026-09-15T17:00:00Z")] },
      "cy@harness.test": { statements: [] },
      "dee@harness.test": { statements: [st("m3", "not_started")] },
    };
    return history[who] ? { status: 200, json: history[who] } : { status: 404, json: { error: "no such learner" } };
  }
  return { status: 404 };
}

const realFetch = globalThis.fetch;
const realEnv = { ...process.env };
const pullIds: string[] = [];
let savedSnapshots: (typeof canaryWireSnapshots.$inferSelect)[] = [];
let savedPulls: (typeof canaryWirePulls.$inferSelect)[] = [];
let requests: string[] = [];

function useMindtickle(handler = mindtickle) {
  process.env.MT_API_KEY = "key";
  process.env.MT_SECRET_KEY = "secret";
  process.env.MT_LS_URL = "harness.mindtickle.test";
  process.env.MT_REGION = "us";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requests.push(url);
    const answer = handler(url, init?.body ? JSON.parse(String(init.body)) : undefined);
    return new Response(answer.json === undefined ? "" : JSON.stringify(answer.json), { status: answer.status });
  }) as typeof fetch;
}

async function start() {
  const started = await startPull("manual", null);
  assert.ok(started.ok, `could not start: ${!started.ok && started.error}`);
  pullIds.push(started.pull.id);
  return started.pull;
}

before(async () => {
  const [running] = await db.select().from(canaryWirePulls).where(eq(canaryWirePulls.status, "running"));
  assert.equal(running, undefined, "a Canary Wire pull is already running in the scratch database");
  savedSnapshots = await db.select().from(canaryWireSnapshots);
  savedPulls = await db.select().from(canaryWirePulls);
  await db.delete(canaryWirePulls);
});

afterEach(async () => {
  globalThis.fetch = realFetch;
  for (const key of ["MT_API_KEY", "MT_SECRET_KEY", "MT_LS_URL", "MT_COMPANY_ID", "MT_REGION"]) {
    if (realEnv[key] === undefined) delete process.env[key];
    else process.env[key] = realEnv[key];
  }
  requests = [];
  if (pullIds.length) await db.delete(canaryWirePulls).where(inArray(canaryWirePulls.id, pullIds));
});

after(async () => {
  await db.transaction(async (tx) => {
    await tx.delete(canaryWireSnapshots);
    if (savedSnapshots.length) await tx.insert(canaryWireSnapshots).values(savedSnapshots);
    await tx.delete(canaryWirePulls);
    if (savedPulls.length) await tx.insert(canaryWirePulls).values(savedPulls);
  });
  await pool.end();
});

describe("a Canary Wire pull", () => {
  test("goes a step at a time, resuming from what it saved, to a stored month", async () => {
    useMindtickle();
    await start();

    const first = (await advancePull(0))!;
    assert.deepEqual([first.status, first.done, first.total], ["running", 1, 5]);
    assert.equal(first.working, false);

    let pull = first;
    let steps = 1;
    while (pull.status === "running") {
      pull = (await advancePull(0))!;
      steps++;
      assert.ok(steps <= 5, "it didn't finish in one step a learner");
    }
    assert.equal(pull.status, "succeeded", pull.error ?? "");
    assert.equal(steps, 5);

    const [row] = await db.select().from(canaryWirePulls).where(eq(canaryWirePulls.id, pull.id));
    // It names everyone it pulled, so nothing of it is kept once it ends.
    assert.equal(row!.state, null);

    // Nothing was asked of the global host twice: each continuation was moved.
    assert.equal(requests.filter((u) => u.startsWith(GLOBAL)).length, 0);

    const view = (await canaryWireView("September 2026"))!;
    const reps = view.teams.flatMap((t) => t.directs);
    // Departed staff are left out without a word; the survey is no column.
    assert.deepEqual(reps.map((r) => r.email).sort(), ["ada", "bo", "cy", "dee", "err"].map((n) => `${n}@harness.test`));
    // Shared first, then SE's own, then the one only SDR has.
    assert.deepEqual(view.labels, ["Flex Pricing", "Demo Day", "Objections"]);
    // Ada's second page, reached through the moved continuation, came in too.
    assert.equal(reps.find((r) => r.email === "ada@harness.test")!.cells["Flex Pricing"]!.state, "Completed");
    assert.equal(reps.find((r) => r.email === "dee@harness.test")!.notActivated, true);
    assert.ok(view.notes.some((n) => n.startsWith("bo@harness.test is in more than one role group")));
    // One learner's history failing costs that learner, not the pull.
    assert.ok(view.notes.some((n) => n.startsWith("xAPI failed for err@harness.test")));
  });

  test("a step leaves a pull another step holds alone", async () => {
    useMindtickle();
    const pull = await start();
    await db.update(canaryWirePulls).set({ leasedUntil: new Date(Date.now() + 60_000) }).where(eq(canaryWirePulls.id, pull.id));
    const after = (await advancePull(0))!;
    assert.deepEqual([after.working, after.done, after.message], [true, 0, "Waiting to start"]);
    assert.deepEqual(requests, []);
    assert.deepEqual(await startPull("manual", null), { ok: false, error: "running" });
  });

  test("a sign-in Mindtickle turns down fails the pull with Mindtickle's reason", async () => {
    useMindtickle((url, body) => (url.endsWith("/auth_token") ? { status: 400, json: { error: "missing parameter ls_url" } } : mindtickle(url, body)));
    await start();
    const pull = (await advancePull(0))!;
    assert.equal(pull.status, "failed");
    assert.match(pull.error ?? "", /400: missing parameter ls_url/);
  });

  test("a refused key pair fails the pull and says why", async () => {
    useMindtickle((url, body) => (url.endsWith("/auth_token") ? { status: 401 } : mindtickle(url, body)));
    await start();
    const pull = (await advancePull(0))!;
    assert.equal(pull.status, "failed");
    assert.match(pull.error ?? "", /refused the key pair/);
  });

  test("without a key pair or the learning site, nothing starts", async () => {
    useMindtickle();
    process.env.MT_LS_URL = "";
    // A company id alone is no tenant Mindtickle will sign in to.
    process.env.MT_COMPANY_ID = "harness";
    assert.deepEqual(await startPull("manual", null), { ok: false, error: "not_configured" });
    process.env.MT_LS_URL = "harness.mindtickle.test";
    delete process.env.MT_API_KEY;
    assert.deepEqual(await startPull("manual", null), { ok: false, error: "not_configured" });
    assert.equal((await scheduledStep(0)).outcome, "not_configured");
  });

  test("the scheduler starts one, steps it, then lets it be for 90 minutes", async () => {
    useMindtickle();
    const started = await scheduledStep(0);
    assert.equal(started.outcome, "started");
    pullIds.push(started.pull!.id);
    assert.equal((await scheduledStep(0)).outcome, "advanced");
    while ((await latestPull())!.status === "running") await scheduledStep(0);
    assert.equal((await latestPull())!.status, "succeeded");
    assert.equal((await scheduledStep(0)).outcome, "fresh");
  });
});
