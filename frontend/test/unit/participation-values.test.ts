/**
 * Participation's rules that need no database: whether anything is marked, and
 * who a press of Generate touches, which carries the rule that matters most,
 * because a submission counts as attendance when a class is released.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_PARTICIPATION_SCORE, generationCounts, hasMarks, planGeneration, type NamedMark } from "@/lib/evals/participation-values";

const up = (count: number): NamedMark => ({ name: "Comes prepared", polarity: "positive", count });
const down = (count: number): NamedMark => ({ name: "Hard to follow", polarity: "negative", count });
const marks = (entries: Record<string, NamedMark[]>) => new Map(Object.entries(entries));

describe("hasMarks", () => {
  test("is true only once a counter is above zero", () => {
    assert.equal(hasMarks([up(0), down(0)]), false);
    assert.equal(hasMarks([up(0), down(1)]), true);
    assert.equal(DEFAULT_PARTICIPATION_SCORE, 3);
  });
});

describe("planGeneration", () => {
  test("someone marked gets the assessment with no other", () => {
    const [plan] = planGeneration(marks({ a: [up(3)] }), new Set(), []);
    assert.equal(plan?.score, 3);
    assert.equal(plan?.writePositive, true);
    assert.equal(plan?.writeConstructive, false);
  });

  test("someone assessed with no marks scores the default 3 with no comments", () => {
    const [plan] = planGeneration(new Map(), new Set(["a"]), []);
    assert.equal(plan?.score, 3);
    assert.equal(plan?.writePositive, false);
    assert.equal(plan?.writeConstructive, false);
  });

  test("someone with neither is left out, or release would count them as attended", () => {
    assert.deepEqual(planGeneration(new Map(), new Set(), []), []);
  });

  test("fills only what is blank and keeps a saved score", () => {
    const existing = [{ email: "a", averageScore: 3, positiveFeedback: "Kept.", constructiveFeedback: " " }];
    const [plan] = planGeneration(marks({ a: [up(3), down(1)] }), new Set(), existing);
    assert.equal(plan?.score, null);
    assert.equal(plan?.writePositive, false);
    assert.equal(plan?.writeConstructive, true);
  });

  test("a blank side with no marks is not waiting on anything", () => {
    const existing = [{ email: "a", averageScore: 3, positiveFeedback: "Kept.", constructiveFeedback: "" }];
    assert.deepEqual(planGeneration(marks({ a: [up(3)] }), new Set(["a"]), existing), []);
  });

  test("an assessment made by a mark gets its score and comment", () => {
    const existing = [{ email: "a", averageScore: null, positiveFeedback: "", constructiveFeedback: "" }];
    const [plan] = planGeneration(marks({ a: [up(3)] }), new Set(), existing);
    assert.equal(plan?.score, 3);
    assert.equal(plan?.writePositive, true);
  });

  test("counts comments, not people", () => {
    const plans = planGeneration(marks({ a: [up(3), down(1)], b: [down(2)] }), new Set(["c"]), []);
    assert.deepEqual(generationCounts(plans), { comments: 3, scores: 3 });
  });
});
