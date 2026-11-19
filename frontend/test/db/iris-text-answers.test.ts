/**
 * Typed answers to the Diagnostic's free-text questions, against a real
 * database, with a stand-in for Claude so a grade is whatever the test says.
 *
 * The rules, restated here independently of `lib/iris`:
 * 1. A typed answer is graded before anything is recorded. A grade that fails
 *    records nothing, so the same words can be sent again.
 * 2. "I don't know" is wrong at once and never sent to be graded.
 * 3. A grade Claude is unsure of counts, so the sitting goes on, and waits on
 *    review if the sitting is live. A preview is never queued.
 * 4. Deciding a queued grade sets the grade that counts, and a finished
 *    sitting is placed again on its answers.
 *
 * No question in the bank is typed yet, so the suite puts one on screen: a
 * fixture registered in the bank's lookup for the length of the suite.
 */

import "../support/test-env";

import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { irisAttempts, irisItemReviews, irisResponses, irisTextAnswers } from "@/db/schema";
import { answer, setTrack, startSitting } from "@/lib/iris/attempts";
import { personDetail } from "@/lib/iris/cohort";
import { IDK, TYPED, type TextItem } from "@/lib/iris/engine";
import type { Grade, GradeResult, Grader } from "@/lib/iris/grade";
import { decideGrade, listGrades } from "@/lib/iris/grades";
import { ITEMS_BY_ID, approveDrafts } from "@/lib/iris/reviews";
import { IRIS_GRADE_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { PERSONAS } from "../support/access";
import { seeded } from "../support/iris-sim";
import { testScope, type TestUser } from "../support/seed";

const scope = testScope("iristext");

const TYPED_ITEM: TextItem = {
  id: "sdlc-l1-typed-fixture",
  kind: "text",
  subject: "sdlc",
  form: "A",
  level: 1,
  subtopic: "version-control",
  version: "1.0",
  stem: "In a few words, what is a pull request for?",
  rationale: "",
  key: {
    expected: "Asking for a change on a branch to be reviewed before it is merged.",
    mustInclude: ["review before merging"],
    alsoAccept: ["merge request"],
    knownWrong: ["a backup of the code"],
    termRequired: false,
    keyVersion: 3,
  },
};

let savedReviews: (typeof irisItemReviews.$inferSelect)[] = [];
let admin: TestUser;

before(async () => {
  await scope.setUp();
  savedReviews = await db.select().from(irisItemReviews);
  await db.delete(irisItemReviews);
  admin = await scope.createUser("admin", PERSONAS.assessmentsAdmin);
  assert.deepEqual(await approveDrafts(admin.id, "sdlc", "A"), { ok: true, written: 38 });
  ITEMS_BY_ID.set(TYPED_ITEM.id, TYPED_ITEM);
});

after(async () => {
  ITEMS_BY_ID.delete(TYPED_ITEM.id);
  await db.delete(irisItemReviews);
  if (savedReviews.length) await db.insert(irisItemReviews).values(savedReviews);
  await scope.tearDown();
});

/** Every call the stand-in for Claude was asked to grade, for the test to check. */
let calls: { itemId: string; answer: string }[] = [];
beforeEach(() => {
  calls = [];
});

const grader =
  (result: Partial<Grade> | GradeResult): Grader =>
  async (item, text) => {
    calls.push({ itemId: item.id, answer: text });
    if ("ok" in result) return result as GradeResult;
    return {
      ok: true,
      model: "test-model",
      grade: { correct: true, matched: ["review before merging"], confidence: "high", reason: "Names review before merging.", ...result },
    };
  };

/** A sitting with the typed fixture on screen as its first question. */
async function typedSitting(name: string, mode: "live" | "preview"): Promise<{ user: TestUser; attemptId: string }> {
  const user = mode === "live" ? await scope.createUser(name, PERSONAS.participant) : admin;
  if (mode === "live") await setTrack(user.id, "AE");
  const start = await startSitting(user.id, "sdlc", "A", mode, seeded(7));
  assert.ok(start.ok, JSON.stringify(start));
  await db
    .update(irisAttempts)
    .set({ currentItemId: TYPED_ITEM.id, optionOrder: null })
    .where(eq(irisAttempts.id, start.sitting.attemptId));
  return { user, attemptId: start.sitting.attemptId };
}

const responsesOf = (attemptId: string) => db.select().from(irisResponses).where(eq(irisResponses.attemptId, attemptId));
const textOf = async (attemptId: string, seq = 1) =>
  (
    await db
      .select()
      .from(irisTextAnswers)
      .where(and(eq(irisTextAnswers.attemptId, attemptId), eq(irisTextAnswers.seq, seq)))
  )[0];

describe("answering a typed question", () => {
  test("a confident grade is recorded with the words, the key it was graded on, and nothing to review", async () => {
    const { user, attemptId } = await typedSitting("confident", "live");
    const res = await answer(
      user.id,
      attemptId,
      1,
      { text: "  So someone reviews the change before it's merged  " },
      seeded(1),
      undefined,
      grader({}),
    );
    assert.ok(res.ok && !res.done, JSON.stringify(res));
    assert.deepEqual(calls, [{ itemId: TYPED_ITEM.id, answer: "So someone reviews the change before it's merged" }]);
    assert.equal(res.sitting.number, 2, "the sitting moved on");

    const [response] = await responsesOf(attemptId);
    assert.equal(response!.choice, TYPED);
    assert.equal(response!.correct, true);
    const text = await textOf(attemptId);
    assert.equal(text!.answer, "So someone reviews the change before it's merged");
    assert.equal(text!.keyVersion, 3);
    assert.equal(text!.model, "test-model");
    assert.deepEqual(text!.matched, ["review before merging"]);
    assert.equal(text!.reviewStatus, null);
  });

  test("the question shown to the taker has no options and no key", async () => {
    const { user, attemptId } = await typedSitting("shown", "live");
    const start = await startSitting(user.id, "sdlc", "A", "live");
    assert.ok(start.ok && start.resumed && start.sitting.attemptId === attemptId);
    assert.deepEqual(start.sitting.question, { kind: "text", stem: TYPED_ITEM.stem, options: [] });
    assert.doesNotMatch(JSON.stringify(start.sitting), /review before merging|Asking for a change/);
  });

  test("an unsure grade counts, and waits on review in a live sitting but not in a preview", async () => {
    const live = await typedSitting("unsure", "live");
    const res = await answer(
      live.user.id,
      live.attemptId,
      1,
      { text: "it gets checked" },
      seeded(1),
      undefined,
      grader({ correct: false, confidence: "low" }),
    );
    assert.ok(res.ok);
    assert.equal((await responsesOf(live.attemptId))[0]!.correct, false);
    assert.equal((await textOf(live.attemptId))!.reviewStatus, "pending");

    const preview = await typedSitting("unsure-preview", "preview");
    const again = await answer(
      admin.id,
      preview.attemptId,
      1,
      { text: "it gets checked" },
      seeded(1),
      undefined,
      grader({ correct: false, confidence: "low" }),
    );
    assert.ok(again.ok);
    assert.equal((await textOf(preview.attemptId))!.reviewStatus, null);
  });

  test("a grade that fails records nothing, so the same words can be sent again", async () => {
    const { user, attemptId } = await typedSitting("failing", "live");
    for (const error of ["upstream", "refused", "unconfigured", "no_key"] as const) {
      const res = await answer(user.id, attemptId, 1, { text: "for code review" }, seeded(1), undefined, grader({ ok: false, error }));
      assert.deepEqual(res, { ok: false, error: "grading_failed", cause: error });
    }
    assert.equal((await responsesOf(attemptId)).length, 0);
    const [attempt] = await db.select().from(irisAttempts).where(eq(irisAttempts.id, attemptId));
    assert.equal(attempt!.questions, 0);
    assert.equal(attempt!.currentItemId, TYPED_ITEM.id, "the same question is still on screen");

    const retry = await answer(user.id, attemptId, 1, { text: "for code review" }, seeded(1), undefined, grader({}));
    assert.ok(retry.ok);
    assert.equal((await responsesOf(attemptId)).length, 1);
  });

  test('"I don\'t know" is wrong at once and never graded', async () => {
    const { user, attemptId } = await typedSitting("shrug", "live");
    const res = await answer(user.id, attemptId, 1, IDK, seeded(1), undefined, grader({}));
    assert.ok(res.ok);
    assert.deepEqual(calls, []);
    const [response] = await responsesOf(attemptId);
    assert.equal(response!.choice, IDK);
    assert.equal(response!.correct, false);
    assert.equal(await textOf(attemptId), undefined);
  });

  test("an option on a typed question, words on a question with options, and too many words are refused ungraded", async () => {
    const typed = await typedSitting("mixed", "live");
    assert.deepEqual(await answer(typed.user.id, typed.attemptId, 1, 2, seeded(1), undefined, grader({})), {
      ok: false,
      error: "invalid_choice",
    });
    const long = Array.from({ length: 26 }, () => "word").join(" ");
    assert.deepEqual(await answer(typed.user.id, typed.attemptId, 1, { text: long }, seeded(1), undefined, grader({})), {
      ok: false,
      error: "invalid_answer",
    });
    assert.deepEqual(await answer(typed.user.id, typed.attemptId, 1, { text: "   " }, seeded(1), undefined, grader({})), {
      ok: false,
      error: "invalid_answer",
    });

    const chooser = await scope.createUser("chooser", PERSONAS.participant);
    await setTrack(chooser.id, "AE");
    const start = await startSitting(chooser.id, "sdlc", "A", "live", seeded(3));
    assert.ok(start.ok);
    assert.deepEqual(await answer(chooser.id, start.sitting.attemptId, 1, { text: "branch" }, seeded(1), undefined, grader({})), {
      ok: false,
      error: "invalid_answer",
    });
    assert.deepEqual(calls, []);
  });

  test("an answer from a stale tab is caught before it is graded", async () => {
    const { user, attemptId } = await typedSitting("stale", "live");
    const res = await answer(user.id, attemptId, 2, { text: "for review" }, seeded(1), undefined, grader({}));
    assert.equal(res.ok, false);
    assert.equal(!res.ok && res.error, "stale");
    assert.deepEqual(calls, []);
  });
});

describe("the review queue", () => {
  /** A finished live sitting with three answers at 301, the second a typed answer graded wrong and queued. */
  async function finishedWithQueuedGrade(name: string): Promise<string> {
    const user = await scope.createUser(name, PERSONAS.participant);
    const [attempt] = await db
      .insert(irisAttempts)
      .values({
        userId: user.id,
        subject: "companies",
        form: "A",
        mode: "live",
        level: 3,
        questions: 3,
        finishedAt: new Date(),
        placement: 1,
        confidence: "low",
      })
      .returning();
    const base = { attemptId: attempt!.id, itemVersion: "1.0", level: 3, subtopic: "x", ms: 1000, phase: "main" };
    await db.insert(irisResponses).values([
      { ...base, seq: 1, itemId: "companies-l3-43", choice: 0, correct: true },
      { ...base, seq: 2, itemId: TYPED_ITEM.id, choice: TYPED, correct: false },
      { ...base, seq: 3, itemId: "companies-l3-44", choice: 1, correct: false },
    ]);
    await db.insert(irisTextAnswers).values({
      attemptId: attempt!.id,
      seq: 2,
      answer: "so a teammate checks it first",
      keyVersion: 3,
      model: "test-model",
      gradedCorrect: false,
      matched: [],
      confidence: "low",
      reason: "Does not say the check is before merging.",
      reviewStatus: "pending",
    });
    return attempt!.id;
  }

  test("lists what waits on review, and the decided ones only when asked", async () => {
    const attemptId = await finishedWithQueuedGrade("listed");
    const query = parseListQuery({ q: "teammate checks" }, IRIS_GRADE_LIST);
    const pending = await listGrades(query);
    assert.equal(pending.rows.length, 1);
    assert.equal(pending.rows[0]!.stem, TYPED_ITEM.stem);
    assert.equal(pending.rows[0]!.expected, TYPED_ITEM.key.expected);
    assert.equal(pending.rows[0]!.reviewStatus, "pending");

    assert.ok((await decideGrade(attemptId, 2, admin.id, false)).ok);
    assert.equal((await listGrades(query)).rows.length, 0);
    const decided = await listGrades(query, { decided: true });
    assert.equal(decided.rows[0]!.reviewStatus, "upheld");
    assert.equal(decided.rows[0]!.reviewedBy?.email, admin.email);
  });

  test("overturning a grade puts it on the record and places a finished sitting again", async () => {
    const attemptId = await finishedWithQueuedGrade("overturned");
    const res = await decideGrade(attemptId, 2, admin.id, true);
    // 2 of 3 right at 301 now clears the bar there.
    assert.deepEqual(res, { ok: true, reviewStatus: "overturned", placement: 3, confidence: "medium" });
    const [response] = await db
      .select()
      .from(irisResponses)
      .where(and(eq(irisResponses.attemptId, attemptId), eq(irisResponses.seq, 2)));
    assert.equal(response!.correct, true);
    const text = await textOf(attemptId, 2);
    assert.equal(text!.gradedCorrect, false, "Claude's grade is kept as given");
    assert.equal(text!.reviewStatus, "overturned");
    const [attempt] = await db.select().from(irisAttempts).where(eq(irisAttempts.id, attemptId));
    assert.equal(attempt!.placement, 3);

    // Deciding again the other way puts Claude's grade back.
    assert.deepEqual(await decideGrade(attemptId, 2, admin.id, false), {
      ok: true,
      reviewStatus: "upheld",
      placement: 1,
      confidence: "low",
    });
  });

  test("a grade nobody queued, or no such answer, cannot be decided", async () => {
    const { user, attemptId } = await typedSitting("unqueued", "live");
    assert.ok((await answer(user.id, attemptId, 1, { text: "for review" }, seeded(1), undefined, grader({}))).ok);
    assert.deepEqual(await decideGrade(attemptId, 1, admin.id, false), { ok: false, error: "not_found" });
    assert.deepEqual(await decideGrade(attemptId, 9, admin.id, false), { ok: false, error: "not_found" });
  });

  test("an administrator's record of the sitting shows the words and how they were graded", async () => {
    const attemptId = await finishedWithQueuedGrade("recorded");
    const [attempt] = await db.select().from(irisAttempts).where(eq(irisAttempts.id, attemptId));
    const detail = await personDetail(attempt!.userId, "A");
    const typed = detail!.sittings[0]!.answers.find((a) => a.seq === 2)!;
    assert.deepEqual(typed.chosen, { index: TYPED, text: "so a teammate checks it first" });
    assert.deepEqual(typed.typed, {
      gradedCorrect: false,
      confidence: "low",
      reason: "Does not say the check is before merging.",
      reviewStatus: "pending",
    });
  });
});
