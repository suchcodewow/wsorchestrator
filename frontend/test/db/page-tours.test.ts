/**
 * Page tours against a real database: that a page finds the most specific
 * tour whose pattern matches it, through Postgres's regex rather than
 * JavaScript's; that saving replaces the steps and moves the version on, and
 * refuses an edit started from an older version; and that what someone has
 * seen only ever goes up, so a tour plays for them again only once it changes.
 *
 * Every pattern here sits under a prefix of this run's own, and only those
 * tours are deleted.
 */

import "../support/test-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { like } from "drizzle-orm";

import { db } from "@/db";
import { pageTours } from "@/db/schema";
import { deleteTour, markTourSeen, saveTour, tourByPattern, tourForPath } from "@/lib/tours/tours";
import { PERSONAS } from "../support/access";
import { testScope, type TestUser } from "../support/seed";

const scope = testScope("tours");
const ROOT = `/wo-test-tours-${randomUUID().slice(0, 8)}`;

const step = (title: string) => ({ title, body: "", placement: "auto" as const, target: { tour: title, label: title } });

let admin: TestUser;
let viewer: TestUser;

before(async () => {
  await scope.setUp();
  admin = await scope.createUser("admin", PERSONAS.platform);
  viewer = await scope.createUser("viewer", PERSONAS.nobody);
});

after(async () => {
  await db.delete(pageTours).where(like(pageTours.pathPattern, `${ROOT}%`));
  await scope.tearDown();
});

describe("finding a page's tour", () => {
  before(async () => {
    await saveTour(admin.id, `${ROOT}/[id]`, { steps: [step("any")] });
    await saveTour(admin.id, `${ROOT}/new`, { steps: [step("new")] });
  });

  test("a [name] segment matches any one segment", async () => {
    const found = await tourForPath(`${ROOT}/3f2c1b8e`, viewer.id);
    assert.equal(found?.tour.pathPattern, `${ROOT}/[id]`);
    assert.equal(found?.tour.steps[0]?.title, "any");
    assert.equal(found?.seenVersion, 0);
  });

  test("the pattern with more written-out segments wins", async () => {
    const found = await tourForPath(`${ROOT}/new`, viewer.id);
    assert.equal(found?.tour.pathPattern, `${ROOT}/new`);
  });

  test("a query and a trailing slash are ignored; a deeper page is not covered", async () => {
    assert.equal((await tourForPath(`${ROOT}/abc/?tab=x`, viewer.id))?.tour.pathPattern, `${ROOT}/[id]`);
    assert.equal(await tourForPath(`${ROOT}/abc/runs`, viewer.id), null);
    assert.equal(await tourForPath(ROOT, viewer.id), null);
  });
});

describe("saving", () => {
  const pattern = `${ROOT}/saving`;

  test("creates at version 1, then replaces every step and moves the version on", async () => {
    const first = await saveTour(admin.id, pattern, { steps: [step("a"), step("b")] });
    assert.ok(first.ok);
    assert.equal(first.tour.version, 1);

    const second = await saveTour(admin.id, pattern, { version: 1, steps: [step("c")] });
    assert.ok(second.ok);
    assert.equal(second.tour.version, 2);
    assert.deepEqual((await tourByPattern(pattern))?.steps.map((s) => s.title), ["c"]);
  });

  test("an edit started from an older version is refused, and changes nothing", async () => {
    const stale = await saveTour(admin.id, pattern, { version: 1, steps: [step("stale")] });
    assert.deepEqual(stale, { ok: false, error: "conflict", version: 2 });
    assert.deepEqual((await tourByPattern(pattern))?.steps.map((s) => s.title), ["c"]);
  });

  test("steps come back in the order they were saved", async () => {
    const order = ["z", "a", "m", "b"];
    await saveTour(admin.id, pattern, { steps: order.map(step) });
    assert.deepEqual((await tourByPattern(pattern))?.steps.map((s) => s.title), order);
  });
});

describe("seen", () => {
  const pattern = `${ROOT}/seen`;

  test("goes up with each version seen, never down, and never past the tour's own", async () => {
    const saved = await saveTour(admin.id, pattern, { steps: [step("a")] });
    assert.ok(saved.ok);
    const id = saved.tour.id;
    await saveTour(admin.id, pattern, { steps: [step("b")] });

    assert.ok(await markTourSeen(viewer.id, id, 2));
    assert.equal((await tourForPath(pattern, viewer.id))?.seenVersion, 2);

    await markTourSeen(viewer.id, id, 1);
    assert.equal((await tourForPath(pattern, viewer.id))?.seenVersion, 2);

    await markTourSeen(viewer.id, id, 99);
    assert.equal((await tourForPath(pattern, viewer.id))?.seenVersion, 2);

    // Someone else's view is their own.
    assert.equal((await tourForPath(pattern, admin.id))?.seenVersion, 0);
  });

  test("a tour that does not exist is reported, not recorded", async () => {
    assert.equal(await markTourSeen(viewer.id, randomUUID(), 1), false);
  });
});

describe("deleting", () => {
  test("removes the tour, and says when there was none", async () => {
    const pattern = `${ROOT}/deleting`;
    await saveTour(admin.id, pattern, { steps: [step("a")] });
    assert.equal(await deleteTour(pattern), true);
    assert.equal(await tourByPattern(pattern), null);
    assert.equal(await deleteTour(pattern), false);
  });
});
