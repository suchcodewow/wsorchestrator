/**
 * "@" tags in a checklist item's name against a real database: who can be
 * tagged, that the person tagged finds the item in their inbox, and that
 * changing the name or owner keeps both in step. The SE tracks keep their own.
 *
 * Items go on the active bootcamp, which may be someone else's, so cleanup
 * deletes only the items this suite added, by id.
 */

import "../support/test-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { inArray } from "drizzle-orm";

process.env.AUTH_SECRET ||= "checklist-mentions-test-secret-checklist-m";

import { db } from "@/db";
import { scheduleChecklistItems } from "@/db/schema";
import { MY_MENTION_LIST } from "@/lib/list-specs";
import { listMyMentions } from "@/lib/mention-store";
import { addChecklistItem, editChecklistItem, listDayItems } from "@/lib/scheduler/checklist";
import { PERSONAS } from "../support/access";
import { testScope, type TestUser } from "../support/seed";

const scope = testScope("chkmention");

let admin: TestUser;
let judge: TestUser;
let bootcampId: string;
const added: string[] = [];

before(async () => {
  await scope.setUp();
  admin = await scope.createUser("admin", PERSONAS.trainingAdmin);
  judge = await scope.createUser("judge", PERSONAS.guestJudge);
  bootcampId = await scope.activeBootcamp(admin.id);
});

after(async () => {
  if (added.length > 0) await db.delete(scheduleChecklistItems).where(inArray(scheduleChecklistItems.id, added));
  await scope.tearDown();
});

describe("tags in a checklist item", () => {
  test("reach the inbox of the guest judge tagged", async () => {
    const name = `Print badges with @judge ${Date.now()}`;
    const saved = await addChecklistItem(admin.id, bootcampId, "btc", 1, { name, mentions: [judge.email] });
    assert.ok(saved.ok);
    added.push(saved.value.id);
    assert.deepEqual(saved.value.mentions, [{ email: judge.email, fullName: "judge" }]);

    const page = await listMyMentions({ email: judge.email, access: judge.access }, { ...MY_MENTION_LIST, q: name, page: 1 });
    const [row] = page.rows;
    assert.equal(page.rows.length, 1);
    assert.equal(row?.kind, "checklist");
    assert.equal(row?.text, name);
    assert.equal(row?.track, "btc");
    assert.equal(row?.day, 1);
    assert.equal(row?.taggedByEmail, admin.email);
  });

  test("cannot name someone who is neither an administrator nor a guest judge of the bootcamp", async () => {
    const stranger = await scope.createUser("stranger", PERSONAS.assessmentsAdmin);
    const saved = await addChecklistItem(admin.id, bootcampId, "btc", 1, { name: "Book the room", mentions: [stranger.email] });
    if (saved.ok) added.push(saved.value.id);
    assert.deepEqual(saved, { ok: false, error: "not_instructor", email: stranger.email });
  });
});

describe("changing a checklist item", () => {
  test("a new name moves its tags, keeping the ones it still makes", async () => {
    const stamp = Date.now();
    const saved = await addChecklistItem(admin.id, bootcampId, "btc", 1, { name: `Ask @judge for slides ${stamp}`, mentions: [judge.email] });
    assert.ok(saved.ok);
    added.push(saved.value.id);

    const name = `Ask @admin and @judge for slides ${stamp}`;
    const both = await editChecklistItem(admin.id, bootcampId, saved.value.id, { name, mentions: [admin.email, judge.email] });
    assert.ok(both.ok);
    assert.deepEqual(both.value.mentions.map((m) => m.email).sort(), [admin.email, judge.email].sort());

    const dropped = await editChecklistItem(admin.id, bootcampId, saved.value.id, { name: `Ask @admin for slides ${stamp}`, mentions: [admin.email] });
    assert.ok(dropped.ok);
    assert.deepEqual(dropped.value.mentions.map((m) => m.email), [admin.email]);
    const page = await listMyMentions({ email: judge.email, access: judge.access }, { ...MY_MENTION_LIST, q: `${stamp}`, page: 1 });
    assert.equal(page.rows.length, 0);
  });

  test("its owner can be set, changed and cleared, leaving the name alone", async () => {
    const saved = await addChecklistItem(admin.id, bootcampId, "btc", 1, { name: `Print badges ${Date.now()}` });
    assert.ok(saved.ok);
    added.push(saved.value.id);

    const owned = await editChecklistItem(admin.id, bootcampId, saved.value.id, { ownerEmail: judge.email });
    assert.ok(owned.ok);
    assert.equal(owned.value.ownerEmail, judge.email);
    assert.equal(owned.value.name, saved.value.name);

    const moved = await editChecklistItem(admin.id, bootcampId, saved.value.id, { ownerEmail: admin.email });
    assert.ok(moved.ok);
    assert.equal(moved.value.ownerEmail, admin.email);

    const cleared = await editChecklistItem(admin.id, bootcampId, saved.value.id, { ownerEmail: null });
    assert.ok(cleared.ok);
    assert.equal(cleared.value.ownerEmail, null);
    assert.equal(cleared.value.ownerName, "");

    const stranger = await scope.createUser("stranger2", PERSONAS.assessmentsAdmin);
    assert.deepEqual(await editChecklistItem(admin.id, bootcampId, saved.value.id, { ownerEmail: stranger.email }), {
      ok: false,
      error: "not_instructor",
      email: stranger.email,
    });
  });

  test("an SE track keeps a list of its own", async () => {
    const name = `Set up SE lab ${Date.now()}`;
    const saved = await addChecklistItem(admin.id, bootcampId, "btc_se", 1, { name });
    assert.ok(saved.ok);
    added.push(saved.value.id);
    assert.ok((await listDayItems(bootcampId, "btc_se", 1)).some((i) => i.id === saved.value.id));
    assert.ok(!(await listDayItems(bootcampId, "btc", 1)).some((i) => i.id === saved.value.id));
  });
});
