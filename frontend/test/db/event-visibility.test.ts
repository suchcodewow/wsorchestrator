/**
 * Whose events each role can see and act on, against a real database.
 *
 * Every lookup of a single event goes through `ownedBy`, so these are the rules
 * behind the run page and every run API route at once:
 * - an operator (or contributor) sees and acts on their own events only;
 * - an event manager or administrator, and a platform administrator, on
 *   everyone's;
 * - someone with no event access — never granted it, a training-only user, or
 *   demoted — on nobody's, including the events they booked themselves.
 *
 * "Can't see it" is always `not_found`, never "forbidden": a person without
 * access learns nothing about which event ids exist.
 */

import "../support/test-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";

import type { Access } from "@/lib/roles";
import {
  deleteRun,
  endRunNow,
  extendRun,
  getRunForViewer,
  listCalendarRuns,
  retryTeardown,
  updateRunConfig,
} from "@/lib/runs";
import { PERSONAS, PERSONA_NAMES, describeAccess, type Persona } from "../support/access";
import { createRun, testScope, type TestUser } from "../support/seed";

const scope = testScope("runs");

const seesEveryonesEvents = (a: Access) =>
  a.platform || a.event === "manager" || a.event === "administrator";
const seesOwnEvents = (a: Access) => a.platform || a.event !== "none";

let alice: TestUser;
let aliceRun: string;
const people = {} as Record<Persona, TestUser>;
const ownRun = {} as Record<Persona, string>;

before(async () => {
  await scope.setUp();
  // Another operator's event, which only the managers and up should reach.
  alice = await scope.createUser("alice", PERSONAS.operator);
  aliceRun = await createRun(alice.id, "Alice's workshop");
  for (const p of PERSONA_NAMES) {
    people[p] = await scope.createUser(p, PERSONAS[p]);
    // Everyone owns one, as someone demoted from operator would.
    ownRun[p] = await createRun(people[p].id, `${p}'s workshop`);
  }
});
after(() => scope.tearDown());

describe("getRunForViewer", () => {
  for (const p of PERSONA_NAMES) {
    test(`${p} (${describeAccess(PERSONAS[p])})`, async () => {
      const a = PERSONAS[p];
      const own = await getRunForViewer(ownRun[p], people[p]);
      const other = await getRunForViewer(aliceRun, people[p]);
      assert.equal(own !== null, seesOwnEvents(a), "own event");
      assert.equal(other !== null, seesEveryonesEvents(a), "someone else's event");
    });
  }

  test("a missing event is null for everyone", async () => {
    const missing = "00000000-0000-0000-0000-000000000000";
    assert.equal(await getRunForViewer(missing, people.platform), null);
  });
});

describe("listCalendarRuns", () => {
  const ids = async (u: TestUser, s: "own" | "all") =>
    new Set((await listCalendarRuns(u, s)).map((r) => r.id));

  for (const p of PERSONA_NAMES) {
    test(`${p} (${describeAccess(PERSONAS[p])})`, async () => {
      const a = PERSONAS[p];
      const own = await ids(people[p], "own");
      const all = await ids(people[p], "all");

      assert.equal(own.has(ownRun[p]), seesOwnEvents(a), "own, in their own calendar");
      assert.equal(own.has(aliceRun), false, "someone else's, in their own calendar");
      // "all" is only honoured for those allowed it; everyone else gets their own.
      assert.equal(all.has(aliceRun), seesEveryonesEvents(a), "someone else's, asking for all");
      if (!seesEveryonesEvents(a)) assert.deepEqual(all, own);
    });
  }
});

describe("acting on an event", () => {
  // Each action is refused as not_found when the event is out of reach. When it
  // is in reach the event is `scheduled`, which each action then refuses or
  // accepts on its own terms — anything but not_found proves the lookup passed.
  type Attempt = (runId: string, viewer: TestUser) => Promise<{ ok: boolean; error?: string }>;
  const ACTIONS: Record<string, Attempt> = {
    endRunNow: (id, v) => endRunNow(id, v),
    extendRun: (id, v) => extendRun(id, v),
    retryTeardown: (id, v) => retryTeardown(id, v),
    updateRunConfig: (id, v) => updateRunConfig(id, v, { userCount: 1, clouds: [] }),
  };

  for (const [name, attempt] of Object.entries(ACTIONS)) {
    test(name, async () => {
      const wrong: string[] = [];
      for (const p of PERSONA_NAMES) {
        const a = PERSONAS[p];
        for (const [which, runId, reachable] of [
          ["own", ownRun[p], seesOwnEvents(a)],
          ["alice's", aliceRun, seesEveryonesEvents(a)],
        ] as const) {
          const result = await attempt(runId, people[p]);
          const found = result.ok || result.error !== "not_found";
          if (found !== reachable) {
            wrong.push(`${p} on ${which}: ${JSON.stringify(result)}, want reachable=${reachable}`);
          }
        }
      }
      assert.deepEqual(wrong, []);
    });
  }

  test("deleteRun: only those who can reach an event can delete it", async () => {
    const wrong: string[] = [];
    for (const p of PERSONA_NAMES) {
      const a = PERSONAS[p];
      const victim = await createRun(alice.id, `for ${p} to try`);
      const result = await deleteRun(victim, people[p]);
      const deleted = result.ok;
      if (deleted !== seesEveryonesEvents(a)) {
        wrong.push(`${p}: ${JSON.stringify(result)}, want deleted=${seesEveryonesEvents(a)}`);
      }
      if (!deleted && result.error !== "not_found") {
        wrong.push(`${p}: refused as ${result.error}, want not_found`);
      }
    }
    assert.deepEqual(wrong, []);
  });

  test("a demoted operator loses the events they booked", async () => {
    const bob = await scope.createUser("bob", PERSONAS.operator);
    const bobs = await createRun(bob.id, "Bob's workshop");
    assert.notEqual(await getRunForViewer(bobs, bob), null);

    const demoted = await scope.createUser("bob", PERSONAS.nobody);
    assert.equal(await getRunForViewer(bobs, demoted), null);
    assert.deepEqual(await endRunNow(bobs, demoted), { ok: false, error: "not_found" });
    assert.deepEqual(await deleteRun(bobs, demoted), { ok: false, error: "not_found" });

    // Their event is still there for a manager to deal with.
    assert.notEqual(await getRunForViewer(bobs, people.manager), null);
  });
});
