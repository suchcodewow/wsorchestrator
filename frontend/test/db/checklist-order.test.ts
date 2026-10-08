/**
 * The order of a checklist half-day against a real database: an added item
 * goes last, one dropped at a place takes it and the half is numbered again,
 * one moved without a place keeps it or goes last in a new half, and copying
 * a schedule keeps the source's order after what is already there.
 *
 * Every bootcamp here is this suite's own, made `scheduled`, and deleted with
 * everything on it when it ends.
 */

import "../support/test-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { inArray } from "drizzle-orm";

process.env.AUTH_SECRET ||= "checklist-order-test-secret-checklist-orde";

import { db } from "@/db";
import { bootcamps, type ChecklistPeriod } from "@/db/schema";
import { addChecklistItem, listDayItems, moveChecklistItem } from "@/lib/scheduler/checklist";
import { copySchedule } from "@/lib/scheduler/schedule";
import { PERSONAS } from "../support/access";
import { testScope, type TestUser } from "../support/seed";

const scope = testScope("chkorder");

let admin: TestUser;
const made: string[] = [];

async function bootcamp(startDate: string): Promise<string> {
  const [row] = await db
    .insert(bootcamps)
    .values({ startDate, btcDays: 2, intDays: null, status: "scheduled", createdBy: admin.id })
    .returning({ id: bootcamps.id });
  made.push(row!.id);
  return row!.id;
}

async function add(bootcampId: string, name: string, period: ChecklistPeriod = "am", day = 1) {
  const saved = await addChecklistItem(admin.id, bootcampId, "btc", day, { name, period });
  assert.ok(saved.ok, `adding ${name}`);
  return saved.value;
}

/** A half's names and positions, in the order the API lists them. */
async function half(bootcampId: string, period: ChecklistPeriod, day = 1) {
  return (await listDayItems(bootcampId, "btc", day)).filter((i) => i.period === period).map((i) => `${i.name}@${i.position}`);
}

before(async () => {
  await scope.setUp();
  admin = await scope.createUser("admin", PERSONAS.trainingAdmin);
});

after(async () => {
  if (made.length > 0) await db.delete(bootcamps).where(inArray(bootcamps.id, made));
  await scope.tearDown();
});

describe("a half-day's order", () => {
  test("an added item goes last in its own half", async () => {
    const id = await bootcamp("2028-01-03");
    await add(id, "One");
    await add(id, "Later", "pm");
    await add(id, "Two");
    await add(id, "Three");
    assert.deepEqual(await half(id, "am"), ["One@0", "Two@1", "Three@2"]);
    assert.deepEqual(await half(id, "pm"), ["Later@0"]);
  });

  test("a card dropped higher or lower takes that place, and the half is numbered again", async () => {
    const id = await bootcamp("2028-01-10");
    const [one, , three] = [await add(id, "One"), await add(id, "Two"), await add(id, "Three")];
    const up = await moveChecklistItem(id, three.id, { position: 0 });
    assert.ok(up.ok);
    assert.equal(up.value.position, 0);
    assert.deepEqual(await half(id, "am"), ["Three@0", "One@1", "Two@2"]);

    assert.ok((await moveChecklistItem(id, one.id, { position: 2 })).ok);
    assert.deepEqual(await half(id, "am"), ["Three@0", "Two@1", "One@2"]);

    assert.ok((await moveChecklistItem(id, three.id, { position: 99 })).ok, "past the end is the end");
    assert.deepEqual(await half(id, "am"), ["Two@0", "One@1", "Three@2"]);
  });

  test("a card dropped in the other half lands at its place there; without one it goes last, or stays put", async () => {
    const id = await bootcamp("2028-01-17");
    const a = await add(id, "A");
    const b = await add(id, "B");
    await add(id, "X", "pm");
    await add(id, "Y", "pm");

    assert.ok((await moveChecklistItem(id, b.id, { period: "pm", position: 1 })).ok);
    assert.deepEqual(await half(id, "pm"), ["X@0", "B@1", "Y@2"]);

    assert.ok((await moveChecklistItem(id, a.id, { period: "pm" })).ok);
    assert.deepEqual(await half(id, "pm"), ["X@0", "B@1", "Y@2", "A@3"], "a new half without a place: last");

    const stay = await moveChecklistItem(id, b.id, { period: "pm" });
    assert.ok(stay.ok);
    assert.deepEqual(await half(id, "pm"), ["X@0", "B@1", "Y@2", "A@3"], "its own half without a place: where it was");

    assert.ok((await moveChecklistItem(id, b.id, { day: 2, period: "am", position: 0 })).ok);
    assert.deepEqual(await half(id, "am", 2), ["B@0"]);
    assert.deepEqual(await half(id, "pm"), ["X@0", "Y@2", "A@3"], "the half it left keeps its order");
  });

  test("copying a schedule keeps the source's order, after what is already there", async () => {
    const source = await bootcamp("2028-01-24");
    const target = await bootcamp("2028-01-31");
    const first = await add(source, "First");
    await add(source, "Second");
    await add(source, "Third");
    assert.ok((await moveChecklistItem(source, first.id, { position: 2 })).ok);
    await add(target, "Already here");

    const copied = await copySchedule(admin.id, target, source, false);
    assert.ok(copied.ok);
    assert.deepEqual(await half(target, "am"), ["Already here@0", "Second@1", "Third@2", "First@3"]);
  });
});
