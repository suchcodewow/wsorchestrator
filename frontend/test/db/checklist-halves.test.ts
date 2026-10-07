/**
 * The AM and PM halves of a checklist day, against a real database: items
 * land in the half they are added to, are counted by half, move between
 * halves and days within the day's limit, and keep their half when a
 * schedule is copied.
 *
 * Every bootcamp here is this suite's own, made `scheduled`, and deleted with
 * everything on it when it ends.
 */

import "../support/test-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { inArray } from "drizzle-orm";

process.env.AUTH_SECRET ||= "checklist-halves-test-secret-checklist-hal";

import { db } from "@/db";
import { bootcamps, scheduleChecklistItems, type ChecklistPeriod } from "@/db/schema";
import { addChecklistItem, checklistCounts, listDayItems, moveChecklistItem, setChecklistItemDone } from "@/lib/scheduler/checklist";
import { copySchedule } from "@/lib/scheduler/schedule";
import { checklistDayLabel } from "@/lib/scheduler/timeline";
import { PERSONAS } from "../support/access";
import { testScope, type TestUser } from "../support/seed";

const scope = testScope("chkhalf");

let admin: TestUser;
const made: string[] = [];

async function bootcamp(startDate: string, btcDays: number, intDays: number | null): Promise<string> {
  const [row] = await db
    .insert(bootcamps)
    .values({ startDate, btcDays, intDays, status: "scheduled", createdBy: admin.id })
    .returning({ id: bootcamps.id });
  made.push(row!.id);
  return row!.id;
}

async function add(bootcampId: string, day: number, name: string, period?: ChecklistPeriod) {
  const saved = await addChecklistItem(admin.id, bootcampId, "btc", day, { name, period });
  assert.ok(saved.ok, `adding ${name}`);
  return saved.value;
}

before(async () => {
  await scope.setUp();
  admin = await scope.createUser("admin", PERSONAS.trainingAdmin);
});

after(async () => {
  if (made.length > 0) await db.delete(bootcamps).where(inArray(bootcamps.id, made));
  await scope.tearDown();
});

describe("the halves of a checklist day", () => {
  test("an item is AM unless added to PM, and each half is counted on its own", async () => {
    const id = await bootcamp("2027-10-04", 2, null);
    const morning = await add(id, 1, "Unlock the room");
    const afternoon = await add(id, 1, "Set out the snacks", "pm");
    await add(id, 1, "Restock the water", "pm");
    assert.equal(morning.period, "am");
    assert.equal(afternoon.period, "pm");
    assert.ok((await setChecklistItemDone({ id: admin.id, email: admin.email, canManage: true }, id, afternoon.id, true)).ok);

    assert.deepEqual(
      (await checklistCounts(id)).map(({ track, day, period, total, done }) => ({ track, day, period, total, done })),
      [
        { track: "btc", day: 1, period: "am", total: 1, done: 0 },
        { track: "btc", day: 1, period: "pm", total: 2, done: 1 },
      ],
    );
    assert.deepEqual((await listDayItems(id, "btc", 1)).map((i) => i.period), ["am", "pm", "pm"], "a day is read whole, both halves");
    assert.equal(checklistDayLabel("btc", 1, "pm"), "Bootcamp, Day 1 PM");
    assert.equal(checklistDayLabel("btc", 0, "am"), "Prep Day AM");
  });

  test("is refused a half that is neither AM nor PM by the database", async () => {
    const id = await bootcamp("2027-10-11", 1, null);
    await assert.rejects(
      db.insert(scheduleChecklistItems).values({ bootcampId: id, track: "btc", day: 1, name: "Nope", period: "noon" as ChecklistPeriod }),
    );
  });
});

describe("moving an item", () => {
  test("to the other half, and to another day, keeping whether it is done", async () => {
    const id = await bootcamp("2027-10-18", 3, 2);
    const item = await add(id, 1, "Test the projector");
    assert.ok((await setChecklistItemDone({ id: admin.id, email: admin.email, canManage: true }, id, item.id, true)).ok);

    const halved = await moveChecklistItem(id, item.id, { period: "pm" });
    assert.ok(halved.ok);
    assert.deepEqual([halved.value.day, halved.value.period, halved.value.done], [1, "pm", true]);

    const later = await moveChecklistItem(id, item.id, { day: 3 });
    assert.ok(later.ok);
    assert.deepEqual([later.value.track, later.value.day, later.value.period], ["btc", 3, "pm"]);

    const across = await moveChecklistItem(id, item.id, { track: "int", day: 2, period: "am" });
    assert.ok(across.ok);
    assert.deepEqual([across.value.track, across.value.day, across.value.period], ["int", 2, "am"]);
    assert.equal(across.value.createdByEmail, admin.email, "who wrote it stays");
    assert.deepEqual(await listDayItems(id, "btc", 1), []);
  });

  test("not to a day the bootcamp does not run, nor into a full day", async () => {
    const id = await bootcamp("2027-10-25", 2, null);
    const item = await add(id, 1, "Book the dinner");
    assert.deepEqual(await moveChecklistItem(id, item.id, { day: 3 }), { ok: false, error: "no_day" });
    assert.deepEqual(await moveChecklistItem(id, item.id, { track: "int", day: 1 }), { ok: false, error: "no_day" });
    assert.deepEqual(await moveChecklistItem(id, item.id, { track: "btc_se", day: 0 }), { ok: false, error: "no_day" });

    await db.insert(scheduleChecklistItems).values(
      Array.from({ length: 100 }, (_, n) => ({ bootcampId: id, track: "btc" as const, day: 2, period: "pm" as const, name: `Filler ${n}` })),
    );
    assert.deepEqual(await moveChecklistItem(id, item.id, { day: 2, period: "am" }), { ok: false, error: "full" });
    const halved = await moveChecklistItem(id, item.id, { period: "pm" });
    assert.ok(halved.ok, "its own day has room for it in either half");
  });

  test("of another bootcamp is not found", async () => {
    const id = await bootcamp("2027-11-01", 1, null);
    const other = await bootcamp("2027-11-08", 1, null);
    const item = await add(id, 1, "Order lunch");
    assert.deepEqual(await moveChecklistItem(other, item.id, { period: "pm" }), { ok: false, error: "not_found" });
  });
});

describe("copying a schedule", () => {
  test("keeps each item in its half, and adds a name already in the other half", async () => {
    const source = await bootcamp("2027-11-15", 1, null);
    const target = await bootcamp("2027-11-22", 1, null);
    await add(source, 1, "Wipe the whiteboards");
    await add(source, 1, "Wipe the whiteboards", "pm");
    await add(source, 1, "Order lunch", "pm");
    await add(target, 1, "Order lunch");

    const copied = await copySchedule(admin.id, target, source, false);
    assert.ok(copied.ok);
    assert.equal(copied.summary.checklistItems, 3);
    assert.deepEqual(
      (await listDayItems(target, "btc", 1)).map((i) => `${i.period} ${i.name}`),
      ["am Order lunch", "am Wipe the whiteboards", "pm Wipe the whiteboards", "pm Order lunch"],
    );
  });
});
