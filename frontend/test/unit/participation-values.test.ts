/**
 * Participation's rules that need no database: the score from net marks, and
 * who a press of Generate touches. The second carries the rule that matters
 * most, because a submission counts as attendance when a class is released.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_PARTICIPATION_BANDS as BANDS,
  bandsInOrder,
  generationCounts,
  netMarks,
  participationScore,
  planGeneration,
  type NamedMark,
} from "@/lib/evals/participation-values";

const up = (count: number): NamedMark => ({ name: "Comes prepared", polarity: "positive", count });
const down = (count: number): NamedMark => ({ name: "Hard to follow", polarity: "negative", count });
const marks = (entries: Record<string, NamedMark[]>) => new Map(Object.entries(entries));

describe("participationScore", () => {
  test("nets positive marks against negative", () => {
    assert.equal(netMarks([up(3), down(1)]), 2);
  });

  test("reads the net against each band", () => {
    const score = (net: number) => participationScore(net >= 0 ? [up(net)] : [down(-net)], BANDS);
    assert.deepEqual([6, 5, 2, 1, -1, -2].map(score), [4, 3, 3, 2, 2, 1]);
  });

  test("marks that cancel out still read the bands", () => {
    assert.equal(participationScore([up(1), down(1)], BANDS), 2);
  });

  test("no marks is a 2, whatever the bands", () => {
    assert.equal(participationScore([], { four: 3, three: 0, two: -3 }), 2);
  });

  test("bands have to fall in order", () => {
    assert.equal(bandsInOrder(BANDS), true);
    assert.equal(bandsInOrder({ four: 2, three: 2, two: -1 }), false);
  });
});

describe("planGeneration", () => {
  test("someone marked gets the assessment with no other", () => {
    const [plan] = planGeneration(marks({ a: [up(3)] }), new Set(), [], BANDS);
    assert.equal(plan?.score, 3);
    assert.equal(plan?.writePositive, true);
    assert.equal(plan?.writeConstructive, false);
  });

  test("someone assessed with no marks scores a 2 with no comments", () => {
    const [plan] = planGeneration(new Map(), new Set(["a"]), [], BANDS);
    assert.equal(plan?.score, 2);
    assert.equal(plan?.writePositive, false);
    assert.equal(plan?.writeConstructive, false);
  });

  test("someone with neither is left out, or release would count them as attended", () => {
    assert.deepEqual(planGeneration(new Map(), new Set(), [], BANDS), []);
  });

  test("fills only what is blank and keeps a saved score", () => {
    const existing = [{ email: "a", averageScore: 3, positiveFeedback: "Kept.", constructiveFeedback: " " }];
    const [plan] = planGeneration(marks({ a: [up(3), down(1)] }), new Set(), existing, BANDS);
    assert.equal(plan?.score, null);
    assert.equal(plan?.writePositive, false);
    assert.equal(plan?.writeConstructive, true);
  });

  test("a blank side with no marks is not waiting on anything", () => {
    const existing = [{ email: "a", averageScore: 3, positiveFeedback: "Kept.", constructiveFeedback: "" }];
    assert.deepEqual(planGeneration(marks({ a: [up(3)] }), new Set(["a"]), existing, BANDS), []);
  });

  test("an assessment made by a mark gets its score and comment", () => {
    const existing = [{ email: "a", averageScore: null, positiveFeedback: "", constructiveFeedback: "" }];
    const [plan] = planGeneration(marks({ a: [up(3)] }), new Set(), existing, BANDS);
    assert.equal(plan?.score, 3);
    assert.equal(plan?.writePositive, true);
  });

  test("counts comments, not people", () => {
    const plans = planGeneration(marks({ a: [up(3), down(1)], b: [down(2)] }), new Set(["c"]), [], BANDS);
    assert.deepEqual(generationCounts(plans), { comments: 3, scores: 3 });
  });
});
