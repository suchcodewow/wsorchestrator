/**
 * The Prep Day checklist, and checklists coming across when one bootcamp's
 * schedule is copied to another, against a real database: every copied item
 * is to do again, Prep Day's included, whatever was ticked at the source.
 *
 * Both bootcamps are this suite's own, made `scheduled`, and deleted with
 * everything on them when it ends.
 */

import "../support/test-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { inArray } from "drizzle-orm";

process.env.AUTH_SECRET ||= "checklist-copy-test-secret-checklist-copy-t";

import { db } from "@/db";
import { bootcamps, scheduleChecklistItems } from "@/db/schema";
import { addChecklistItem, listDayItems, setChecklistItemDone } from "@/lib/scheduler/checklist";
import { copySchedule } from "@/lib/scheduler/schedule";
import { checklistDayLabel } from "@/lib/scheduler/timeline";
import { PERSONAS } from "../support/access";
import { testScope, type TestUser } from "../support/seed";

const scope = testScope("chkcopy");

let admin: TestUser;
let judge: TestUser;
const made: string[] = [];

async function bootcamp(startDate: string, btcDays: number, intDays: number | null): Promise<string> {
  const [row] = await db
    .insert(bootcamps)
    .values({ startDate, btcDays, intDays, status: "scheduled", createdBy: admin.id })
    .returning({ id: bootcamps.id });
  made.push(row!.id);
  return row!.id;
}

async function add(bootcampId: string, track: "btc" | "int" | "btc_se", day: number, name: string, extra: { ownerEmail?: string; mentions?: string[] } = {}) {
  const saved = await addChecklistItem(admin.id, bootcampId, track, day, { name, ...extra });
  assert.ok(saved.ok, `adding ${name}`);
  return saved.value;
}

before(async () => {
  await scope.setUp();
  admin = await scope.createUser("admin", PERSONAS.trainingAdmin);
  // A guest judge of the active bootcamp only, so of neither bootcamp here.
  judge = await scope.createUser("judge", PERSONAS.guestJudge);
});

after(async () => {
  if (made.length > 0) await db.delete(bootcamps).where(inArray(bootcamps.id, made));
  await scope.tearDown();
});

describe("the Prep Day checklist", () => {
  test("is day 0 of Bootcamp, and of no other track", async () => {
    const id = await bootcamp("2027-05-03", 3, 2);
    const prep = await add(id, "btc", 0, "Ship the laptops");
    assert.equal(prep.day, 0);
    assert.deepEqual((await listDayItems(id, "btc", 0)).map((i) => i.id), [prep.id]);
    assert.deepEqual(await addChecklistItem(admin.id, id, "int", 0, { name: "Nope" }), { ok: false, error: "no_day" });
    assert.deepEqual(await addChecklistItem(admin.id, id, "btc_se", 0, { name: "Nope" }), { ok: false, error: "no_day" });
    assert.equal(checklistDayLabel("btc", 0), "Prep Day");
    assert.equal(checklistDayLabel("btc_se", 2), "SE Bootcamp, Day 2");
  });

  test("is refused on any other track by the database too", async () => {
    const id = await bootcamp("2027-05-10", 3, 2);
    await assert.rejects(db.insert(scheduleChecklistItems).values({ bootcampId: id, track: "int", day: 0, name: "Nope" }));
    await assert.rejects(db.insert(scheduleChecklistItems).values({ bootcampId: id, track: "btc", day: -1, name: "Nope" }));
  });
});

describe("copying a schedule", () => {
  test("brings the checklists of the days it keeps and Prep Day's, every item to do", async () => {
    const source = await bootcamp("2027-06-07", 3, 2);
    const target = await bootcamp("2027-07-12", 2, null);

    const prep = await add(source, "btc", 0, "Ship the laptops", { ownerEmail: admin.email });
    const first = await add(source, "btc", 1, "Print badges for @admin", { mentions: [admin.email] });
    const second = await add(source, "btc", 1, "Test the projector");
    await add(source, "btc", 1, "Order lunch");
    await add(source, "btc", 3, "Book the dinner");
    await add(source, "int", 1, "Set up the int lab");
    await add(source, "btc_se", 2, "Set up the SE lab");
    for (const item of [prep, first, second]) {
      assert.ok((await setChecklistItemDone({ id: admin.id, email: admin.email, canManage: true }, source, item.id, true)).ok);
    }
    // Owned by someone who is not an instructor of the target, as it could not be added through the lib.
    await db.insert(scheduleChecklistItems).values({
      bootcampId: source,
      track: "btc",
      day: 2,
      name: "Collect the feedback",
      ownerEmail: judge.email,
      ownerName: "judge",
    });

    const mine = await add(target, "btc", 1, "ORDER LUNCH");

    const copied = await copySchedule(admin.id, target, source, false);
    assert.ok(copied.ok);
    assert.equal(copied.summary.checklistItems, 5);
    assert.ok(copied.summary.notes.some((n) => n.includes("Left 1 person off checklist items") && n.includes("judge")));
    assert.ok(copied.summary.notes.some((n) => n.includes("Left out 1 checklist item this bootcamp already has")));

    const prepDay = await listDayItems(target, "btc", 0);
    assert.deepEqual(
      prepDay.map((i) => ({ name: i.name, done: i.done, doneAt: i.doneAt, doneByName: i.doneByName, ownerEmail: i.ownerEmail })),
      [{ name: "Ship the laptops", done: false, doneAt: null, doneByName: "", ownerEmail: admin.email }],
    );

    const day1 = await listDayItems(target, "btc", 1);
    assert.deepEqual(
      day1.map((i) => i.name),
      [mine.name, "Print badges for @admin", "Test the projector"],
      "its own item stays first, the copies keep the source's order, and the same name is not added twice",
    );
    assert.ok(day1.every((i) => !i.done));
    assert.deepEqual(day1[1]!.mentions, [{ email: admin.email, fullName: "admin" }]);
    assert.equal(day1[1]!.createdByEmail, admin.email);

    const day2 = await listDayItems(target, "btc", 2);
    assert.deepEqual(day2.map((i) => ({ name: i.name, ownerEmail: i.ownerEmail, ownerName: i.ownerName })), [
      { name: "Collect the feedback", ownerEmail: null, ownerName: "" },
    ]);
    assert.deepEqual((await listDayItems(target, "btc_se", 2)).map((i) => i.name), ["Set up the SE lab"]);
    assert.deepEqual(await listDayItems(target, "btc", 3), [], "a day the target does not run is left out");
    assert.deepEqual(await listDayItems(target, "int", 1), [], "a track the target does not hold is left out");

    // The source is left as it was.
    assert.ok((await listDayItems(source, "btc", 0))[0]!.done);
  });

  test("a second copy with replace adds nothing it already has", async () => {
    const source = await bootcamp("2027-08-02", 2, null);
    const target = await bootcamp("2027-09-06", 2, null);
    await add(source, "btc", 0, "Ship the laptops");
    assert.ok((await copySchedule(admin.id, target, source, false)).ok);
    const again = await copySchedule(admin.id, target, source, true);
    assert.ok(again.ok);
    assert.equal(again.summary.checklistItems, 0);
    assert.equal((await listDayItems(target, "btc", 0)).length, 1);
  });
});
