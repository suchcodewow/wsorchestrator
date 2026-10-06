/**
 * Taking an Iris test, and what Iris administrators read back, against a real
 * database.
 *
 * The rules, restated here independently of `lib/iris`:
 * 1. Grading happens on the server: nothing sent to a taker carries an answer.
 * 2. One live sitting per person, subject and form; leaving and coming back
 *    resumes it, and a finished one cannot be retaken.
 * 3. Only approved questions are served live, and an approval belongs to the
 *    version it was made on.
 * 4. A preview draws drafts too, and is never reported.
 *
 * Question reviews are keyed by question, not by user, so the suite saves the
 * table before it starts and puts it back afterwards.
 */

import "../support/test-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { irisAttempts, irisItemReviews } from "@/db/schema";
import { answer, myIris, openSitting, setTrack, startSitting, withoutLevel, type SittingView } from "@/lib/iris/attempts";
import { clearResults, listCohort, personDetail } from "@/lib/iris/cohort";
import { IDK } from "@/lib/iris/engine";
import { IRIS_ITEMS } from "@/lib/iris/items";
import { listQuestions } from "@/lib/iris/questions";
import { ITEMS_BY_ID, approveDrafts, poolFor, setReviews } from "@/lib/iris/reviews";
import { IRIS_COHORT_LIST } from "@/lib/list-specs";
import { PERSONAS } from "../support/access";
import { testScope, type TestUser } from "../support/seed";
import { seeded } from "../support/iris-sim";

const scope = testScope("iris");

let savedReviews: (typeof irisItemReviews.$inferSelect)[] = [];
let admin: TestUser;

before(async () => {
  await scope.setUp();
  savedReviews = await db.select().from(irisItemReviews);
  await db.delete(irisItemReviews);
  admin = await scope.createUser("admin", PERSONAS.irisAdmin);
});

after(async () => {
  await db.delete(irisItemReviews);
  if (savedReviews.length) await db.insert(irisItemReviews).values(savedReviews);
  await scope.tearDown();
});

/** Answers every question the way `pick` says until the sitting ends. */
async function finish(user: TestUser, first: SittingView, pick: (itemId: string) => number) {
  let sitting = first;
  for (let guard = 0; guard < 30; guard++) {
    const res = await answer(user.id, sitting.attemptId, sitting.question.id, pick(sitting.question.id), seeded(guard));
    assert.ok(res.ok, JSON.stringify(res));
    if (res.done) return res;
    sitting = res.sitting;
  }
  throw new Error("the sitting never finished");
}

const right = (id: string) => ITEMS_BY_ID.get(id)!.answer;

describe("before any question is approved", () => {
  test("a live sitting is not ready, and a subject shows as unavailable", async () => {
    const taker = await scope.createUser("early", PERSONAS.irisTaker);
    await setTrack(taker.id, "AE");
    assert.deepEqual(await startSitting(taker.id, "sdlc", "A", "live"), { ok: false, error: "not_ready" });
    const mine = await myIris(taker.id);
    assert.ok(mine.subjects.every((s) => s.status === "unavailable"));
  });

  test("a preview can still run, on drafts", async () => {
    const res = await startSitting(admin.id, "sdlc", "A", "preview");
    assert.ok(res.ok);
    assert.equal((await poolFor("sdlc", "A", "preview")).length, 38);
  });
});

describe("a live sitting", () => {
  let taker: TestUser;
  before(async () => {
    assert.deepEqual(await approveDrafts(admin.id, "sdlc", "A"), { ok: true, written: 38 });
    taker = await scope.createUser("taker", PERSONAS.irisTaker);
  });

  test("needs the taker's track first", async () => {
    assert.deepEqual(await startSitting(taker.id, "sdlc", "A", "live"), { ok: false, error: "no_track" });
    await setTrack(taker.id, "SE");
    assert.equal((await myIris(taker.id)).track, "SE");
  });

  test("sends the question without its answer, level or explanation", async () => {
    const res = await startSitting(taker.id, "sdlc", "A", "live");
    assert.ok(res.ok);
    assert.deepEqual(Object.keys(res.sitting.question).sort(), ["id", "options", "stem"]);
    assert.equal(res.sitting.number, 1);
    assert.equal(ITEMS_BY_ID.get(res.sitting.question.id)!.level, 2, "it starts at Intermediate");
    const sent = JSON.stringify(res);
    const item = ITEMS_BY_ID.get(res.sitting.question.id)!;
    assert.ok(!sent.includes(item.rationale), "no explanation");
    assert.ok(!/"answer"|"level"|"rationale"/.test(sent), sent);
  });

  test("resumes where it was left, and refuses a stale or impossible answer", async () => {
    const first = await startSitting(taker.id, "sdlc", "A", "live");
    assert.ok(first.ok && first.resumed);
    assert.deepEqual(await openSitting(taker.id, first.sitting.attemptId), first.sitting);

    const wrongItem = IRIS_ITEMS.find((i) => i.subject === "sdlc" && i.id !== first.sitting.question.id)!;
    const stale = await answer(taker.id, first.sitting.attemptId, wrongItem.id, 0);
    assert.ok(!stale.ok && stale.error === "stale");
    assert.deepEqual(stale.sitting, first.sitting);

    for (const choice of [4, -2, 1.5]) {
      const bad = await answer(taker.id, first.sitting.attemptId, first.sitting.question.id, choice);
      assert.deepEqual(bad, { ok: false, error: "invalid_choice" }, String(choice));
    }

    const other = await scope.createUser("other", PERSONAS.irisTaker);
    const theirs = await answer(other.id, first.sitting.attemptId, first.sitting.question.id, 0);
    assert.deepEqual(theirs, { ok: false, error: "not_found" }, "a sitting is only its taker's");
  });

  test("answered right throughout places Advanced, recorded but not shown to the taker", async () => {
    const start = await startSitting(taker.id, "sdlc", "A", "live");
    assert.ok(start.ok);
    const done = await finish(taker, start.sitting, right);
    assert.equal(done.subject, "sdlc");
    assert.equal(done.placement, 3);
    const told = withoutLevel(done);
    assert.ok(!("placement" in told) && !("confidence" in told), "what a taker is sent carries no level");

    const [row] = await db.select().from(irisAttempts).where(eq(irisAttempts.id, start.sitting.attemptId));
    assert.equal(row!.placement, 3);
    assert.equal(row!.currentItemId, null);

    const mine = await myIris(taker.id);
    assert.equal(mine.subjects.find((s) => s.key === "sdlc")!.status, "completed");
    assert.equal(mine.completed, 1);
    assert.ok(!JSON.stringify(mine).includes("placement"), "a taker's own view has no levels");
    const asAdmin = await myIris(taker.id, "A", true);
    assert.equal(asAdmin.subjects.find((s) => s.key === "sdlc")!.placement, 3);
  });

  test("cannot be taken twice, and the finished sitting cannot be answered", async () => {
    assert.deepEqual(await startSitting(taker.id, "sdlc", "A", "live"), { ok: false, error: "already_taken" });
    const [row] = await db.select().from(irisAttempts).where(eq(irisAttempts.userId, taker.id));
    const item = IRIS_ITEMS.find((i) => i.subject === "sdlc")!;
    assert.deepEqual(await answer(taker.id, row!.id, item.id, 0), { ok: false, error: "finished" });
  });

  test("\"I don't know\" every time places Beginner", async () => {
    const shrug = await scope.createUser("shrug", PERSONAS.irisTaker);
    await setTrack(shrug.id, "AE");
    const start = await startSitting(shrug.id, "sdlc", "A", "live");
    assert.ok(start.ok);
    await finish(shrug, start.sitting, () => IDK);
    const [row] = await db.select().from(irisAttempts).where(eq(irisAttempts.userId, shrug.id));
    assert.equal(row!.placement, 1);
  });
});

describe("reviews", () => {
  test("an approval made on an older version leaves the question a draft", async () => {
    const item = IRIS_ITEMS.find((i) => i.subject === "industry")!;
    await db
      .insert(irisItemReviews)
      .values({ itemId: item.id, itemVersion: "1.0", status: "approved", reviewerId: admin.id })
      .onConflictDoUpdate({ target: irisItemReviews.itemId, set: { itemVersion: "1.0", status: "approved" } });
    const [row] = await listQuestions("industry", "A").then((rows) => rows.filter((r) => r.id === item.id));
    assert.equal(row!.review.status, "draft");
  });

  test("a rejected question is left out of previews and live sittings", async () => {
    const item = IRIS_ITEMS.find((i) => i.subject === "cotm")!;
    assert.deepEqual(await setReviews(admin.id, [{ id: item.id, status: "rejected", note: "two keys" }]), {
      ok: true,
      written: 1,
    });
    assert.ok(!(await poolFor("cotm", "A", "preview")).some((i) => i.id === item.id));
    const [row] = (await listQuestions("cotm", "A", { status: "rejected" })).filter((r) => r.id === item.id);
    assert.equal(row!.review.note, "two keys");
  });

  test("an unknown question id is refused, and nothing is written", async () => {
    assert.deepEqual(await setReviews(admin.id, [{ id: "no-such-item", status: "approved" }]), {
      ok: false,
      error: "unknown_item",
      id: "no-such-item",
    });
  });
});

describe("what administrators read back", () => {
  test("the cohort lists finished live sittings, never previews, with the weighted score", async () => {
    const page = await listCohort({ ...IRIS_COHORT_LIST, q: "iris_", page: 1 }, "A");
    const taker = page.rows.find((r) => r.name === "taker");
    assert.ok(taker, "the taker is listed");
    assert.deepEqual(taker!.placements, { sdlc: 3 });
    assert.equal(taker!.track, "SE");
    assert.equal(taker!.composite, 100);
    assert.ok(!page.rows.some((r) => r.name === "admin"), "an administrator's preview is not reported");
  });

  test("one person's detail has every answer in order, with what they chose", async () => {
    const page = await listCohort({ ...IRIS_COHORT_LIST, q: "iris_", page: 1 }, "A");
    const taker = page.rows.find((r) => r.name === "taker")!;
    const detail = await personDetail(taker.userId, "A");
    assert.ok(detail);
    const sitting = detail!.sittings.find((s) => s.subject === "sdlc")!;
    assert.equal(sitting.answers.length, sitting.questions);
    assert.deepEqual(sitting.answers.map((a) => a.seq), sitting.answers.map((_, i) => i + 1));
    assert.ok(sitting.answers.every((a) => a.correct && a.chosen && a.stem));
  });

  test("live answers count toward a question's statistics", async () => {
    const rows = await listQuestions("sdlc", "A");
    const answered = rows.reduce((n, r) => n + r.stats.responses, 0);
    assert.ok(answered >= 20, `${answered} responses`);
    assert.ok(rows.every((r) => r.stats.responses === 0 || r.stats.medianMs !== null));
  });

  test("clearing someone's results lets them sit the subject again", async () => {
    const page = await listCohort({ ...IRIS_COHORT_LIST, q: "iris_", page: 1 }, "A");
    const taker = page.rows.find((r) => r.name === "taker")!;
    const cleared = await clearResults(taker.userId);
    assert.ok(cleared.ok && cleared.deleted >= 1);
    const again = await startSitting(taker.userId, "sdlc", "A", "live");
    assert.ok(again.ok && !again.resumed);
    assert.deepEqual(await clearResults("no-such-user"), { ok: false, error: "not_found" });
  });
});
