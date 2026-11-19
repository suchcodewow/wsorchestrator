/**
 * The Bootcamp superlatives survey against a real database: sending it to
 * the class, who sees it and whom they can vote for, the votes it keeps and
 * refuses, the count on Survey Results, and unassigning and sending it again.
 *
 * Its people are three Bootcamp candidates of its own, under `TEST_PREFIX`;
 * the class may hold others, so it asserts only on them. It sends to a
 * bootcamp of its own, and puts back the standing list it found.
 */

import "../support/test-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { bootcamps, employees, superlativeLists, superlativeSurveys, type Superlative } from "@/db/schema";
import { listMyForms } from "@/lib/surveys/my-forms";
import {
  getMySuperlatives,
  getSuperlativeList,
  getSuperlativeResult,
  listSuperlativeResults,
  saveMySuperlatives,
  saveSuperlativeList,
  sendSuperlatives,
  superlativeStatus,
  unassignSuperlatives,
} from "@/lib/surveys/superlatives";
import { PERSONAS } from "../support/access";
import { TEST_EMAIL_DOMAIN, TEST_PREFIX } from "../support/db";
import { testScope, type TestUser } from "../support/seed";

const scope = testScope("superl");
const today = new Date().toISOString().slice(0, 10);

let admin: TestUser;
let bootcampId: string;
let saved: { superlatives: Superlative[] } | null;
let ana: string;
let ben: string;
let cy: string;

async function candidate(key: string, track: "sales" | "engineer") {
  const email = `${TEST_PREFIX}superl_${key}@${TEST_EMAIL_DOMAIN}`.toLowerCase();
  await db
    .insert(employees)
    .values({
      id: `${TEST_PREFIX}superl_${key}`,
      email,
      fullName: `Superl ${key}`,
      title: "Account Executive",
      track,
      orgDepth: 2,
      startDate: today,
      activeEffectiveDate: today,
      raw: {},
    })
    .onConflictDoNothing();
  return email;
}

/** `email`'s copy of the survey, from their list of forms. */
async function myCopy(email: string): Promise<string> {
  const form = (await listMyForms(email)).find((f) => f.kind === "superlatives");
  assert.ok(form, `${email} has no superlatives to fill in`);
  return form.id;
}

before(async () => {
  await scope.setUp();
  admin = await scope.createUser("admin", PERSONAS.trainingAdmin);
  const [row] = await db
    .insert(bootcamps)
    .values({ startDate: "2027-03-01", btcDays: 4, intDays: 3, status: "scheduled", createdBy: admin.id })
    .returning({ id: bootcamps.id });
  bootcampId = row!.id;
  const [list] = await db.select({ superlatives: superlativeLists.superlatives }).from(superlativeLists);
  saved = list ?? null;
  await db.delete(superlativeLists);
  ana = await candidate("ana", "sales");
  ben = await candidate("ben", "sales");
  cy = await candidate("cy", "engineer");
});

after(async () => {
  await db.delete(superlativeSurveys).where(eq(superlativeSurveys.bootcampId, bootcampId));
  await db.delete(bootcamps).where(eq(bootcamps.id, bootcampId));
  await db.delete(superlativeLists);
  if (saved) await db.insert(superlativeLists).values({ id: "bootcamp", superlatives: saved.superlatives });
  await scope.tearDown();
});

describe("the Bootcamp superlatives survey", () => {
  test("is not sent with no superlatives on the standing list", async () => {
    assert.deepEqual(await sendSuperlatives(admin.id, bootcampId), { ok: false, error: "no_superlatives" });
    assert.equal(await superlativeStatus(bootcampId), null);
  });

  test("the standing list keeps its order and gives new superlatives ids", async () => {
    const list = await saveSuperlativeList(admin.id, { superlatives: [{ title: "Best demo" }, { title: " Most likely to close " }] });
    assert.deepEqual(
      list.superlatives.map((x) => x.title),
      ["Best demo", "Most likely to close"],
    );
    assert.ok(list.superlatives.every((x) => x.id.length > 0));
    assert.deepEqual((await getSuperlativeList()).superlatives, list.superlatives);
  });

  test("goes to the whole class, Sales and Engineers together", async () => {
    const result = await sendSuperlatives(admin.id, bootcampId);
    assert.ok(result.ok);
    assert.equal(result.value.created, true);
    assert.equal(result.value.superlatives, 2);
    assert.ok(result.value.sent >= 3);
    for (const email of [ana, ben, cy]) await myCopy(email);
    const status = await superlativeStatus(bootcampId);
    assert.equal(status?.answered, 0);
  });

  test("sending it again while it is out sends no one a second", async () => {
    const result = await sendSuperlatives(admin.id, bootcampId);
    assert.ok(result.ok);
    assert.equal(result.value.created, false);
    assert.equal(result.value.sent, 0);
  });

  test("someone can vote for anyone in the class but themselves", async () => {
    const mine = await getMySuperlatives(ana, await myCopy(ana));
    assert.ok(mine);
    const ballot = mine.ballot.map((n) => n.email);
    assert.ok(!ballot.includes(ana));
    assert.ok(ballot.includes(ben) && ballot.includes(cy));
    assert.equal(mine.votes, null);
  });

  test("someone else's copy is not found", async () => {
    assert.equal(await getMySuperlatives(ben, await myCopy(ana)), null);
  });

  test("keeps votes for classmates, and refuses one for themselves", async () => {
    const [demo, close] = (await getSuperlativeList()).superlatives;
    const anaCopy = await myCopy(ana);
    const refused = await saveMySuperlatives(ana, anaCopy, { votes: { [demo!.id]: ana, [close!.id]: ben } });
    assert.deepEqual(refused, { ok: false, error: { problem: "self_vote", superlativeId: demo!.id } });

    const kept = await saveMySuperlatives(ana, anaCopy, { votes: { [demo!.id]: cy, [close!.id]: ben.toUpperCase() } });
    assert.ok(kept.ok);
    assert.deepEqual(kept.survey.votes, { [demo!.id]: cy, [close!.id]: ben });
    assert.ok(kept.survey.submittedAt);
    assert.ok(await saveMySuperlatives(ben, await myCopy(ben), { votes: { [demo!.id]: cy, [close!.id]: ana } }));
    assert.equal((await listMyForms(ana)).find((f) => f.kind === "superlatives")?.completedAt, kept.survey.submittedAt);
  });

  test("Survey Results counts the votes on each superlative", async () => {
    const [demo, close] = (await getSuperlativeList()).superlatives;
    const card = (await listSuperlativeResults()).find((r) => r.bootcampId === bootcampId);
    assert.ok(card);
    assert.equal(card.responses, 2);

    const result = await getSuperlativeResult(card.id);
    assert.ok(result);
    const onDemo = result.superlatives.find((x) => x.id === demo!.id)!;
    assert.deepEqual(onDemo.standings, [{ email: cy, fullName: "Superl cy", votes: 2 }]);
    const onClose = result.superlatives.find((x) => x.id === close!.id)!;
    assert.equal(onClose.votes, 2);
    assert.deepEqual(
      onClose.standings.map((s) => s.votes),
      [1, 1],
    );
  });

  test("editing the standing list leaves the survey out as it was sent", async () => {
    const [demo] = (await getSuperlativeList()).superlatives;
    await saveSuperlativeList(admin.id, { superlatives: [demo!, { title: "Best question" }] });
    const mine = await getMySuperlatives(ana, await myCopy(ana));
    assert.deepEqual(
      mine?.superlatives.map((x) => x.title),
      ["Best demo", "Most likely to close"],
    );
  });

  test("unassigning hides it from the class but keeps the votes", async () => {
    const anaCopy = await myCopy(ana);
    const result = await unassignSuperlatives(bootcampId);
    assert.deepEqual(result, { ok: true, value: { unassigned: 1 } });
    assert.equal(await getMySuperlatives(ana, anaCopy), null);
    assert.equal(await superlativeStatus(bootcampId), null);
    const card = (await listSuperlativeResults()).find((r) => r.bootcampId === bootcampId);
    assert.equal((await getSuperlativeResult(card!.id))?.unassigned, true);
  });

  test("sending it again asks the list as it now stands, keeping each vote that still fits", async () => {
    const result = await sendSuperlatives(admin.id, bootcampId);
    assert.ok(result.ok);
    assert.equal(result.value.created, true);
    const [demo, question] = (await getSuperlativeList()).superlatives;
    const mine = await getMySuperlatives(ana, await myCopy(ana));
    assert.deepEqual(
      mine?.superlatives.map((x) => x.title),
      ["Best demo", "Best question"],
    );
    // Her vote on Best demo still fits; Best question is new, so she is asked again.
    assert.deepEqual(mine?.votes, { [demo!.id]: cy });
    assert.equal(mine?.submittedAt, null);
    assert.ok(question);
  });
});
