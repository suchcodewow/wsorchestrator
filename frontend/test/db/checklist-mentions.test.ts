/**
 * "@" tags in a checklist item's name against a real database: who can be
 * tagged, and that the person tagged finds the item in their inbox.
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
import { addChecklistItem } from "@/lib/scheduler/checklist";
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
    const stranger = await scope.createUser("stranger", PERSONAS.evalsAdmin);
    const saved = await addChecklistItem(admin.id, bootcampId, "btc", 1, { name: "Book the room", mentions: [stranger.email] });
    if (saved.ok) added.push(saved.value.id);
    assert.deepEqual(saved, { ok: false, error: "not_instructor", email: stranger.email });
  });
});
