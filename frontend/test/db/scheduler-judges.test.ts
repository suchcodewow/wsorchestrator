/**
 * What of the Scheduler a guest judge reaches, against a real database.
 *
 * A judge with no training role sees the active bootcamp, the one they judge,
 * and no other: not a scheduled one, even one they are a judge on too, and not
 * an id that names nothing. A Training Viewer reads every bootcamp, and someone
 * with neither reads none. The pages and routes all ask `mayReadBootcamp`, and
 * the Scheduler's list narrows with `listBootcamps(…, onlyActive)`.
 */

import "../support/test-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { db } from "@/db";
import { bootcampJudges, bootcamps } from "@/db/schema";
import { BOOTCAMP_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { listBootcamps } from "@/lib/scheduler/bootcamps";
import { isJudgingNow, mayReadBootcamp } from "@/lib/scheduler/judging";
import { PERSONAS } from "../support/access";
import { testScope, type TestUser } from "../support/seed";

const scope = testScope("schedjudge");

let judge: TestUser;
let activeId: string;
let scheduledId: string;

before(async () => {
  await scope.setUp();
  const alice = await scope.createUser("alice", PERSONAS.operator);
  judge = await scope.createUser("judge", PERSONAS.guestJudge);
  activeId = await scope.activeBootcamp(alice.id);
  const [scheduled] = await db
    .insert(bootcamps)
    .values({ startDate: "2027-02-01", btcDays: 4, intDays: 3, status: "scheduled", createdBy: alice.id })
    .returning({ id: bootcamps.id });
  scheduledId = scheduled!.id;
  // Judging a later bootcamp as well gives them nothing of it until it is active.
  await db.insert(bootcampJudges).values({ bootcampId: scheduledId, email: judge.email }).onConflictDoNothing();
});
after(() => scope.tearDown());

describe("mayReadBootcamp", () => {
  test("the seeded judge is judging now", async () => {
    assert.equal(await isJudgingNow(judge.email), true);
  });

  test("a guest judge reads the active bootcamp only", async () => {
    assert.equal(await mayReadBootcamp(PERSONAS.guestJudge, activeId), true);
    assert.equal(await mayReadBootcamp(PERSONAS.guestJudge, scheduledId), false);
    assert.equal(await mayReadBootcamp(PERSONAS.guestJudge, randomUUID()), false);
    assert.equal(await mayReadBootcamp(PERSONAS.guestJudge, "not-an-id"), false);
  });

  test("a Training Viewer reads every bootcamp", async () => {
    assert.equal(await mayReadBootcamp(PERSONAS.trainingViewer, activeId), true);
    assert.equal(await mayReadBootcamp(PERSONAS.trainingViewer, scheduledId), true);
  });

  test("someone with neither reads none, the active one included", async () => {
    for (const p of ["nobody", "assessmentsViewer", "peopleManager"] as const) {
      assert.equal(await mayReadBootcamp(PERSONAS[p], activeId), false, p);
    }
  });
});

describe("listBootcamps for a judge", () => {
  test("lists the active bootcamp and nothing else", async () => {
    const page = await listBootcamps(parseListQuery({}, BOOTCAMP_LIST), true, true);
    assert.deepEqual(page.rows.map((r) => r.id), [activeId]);
  });
});
