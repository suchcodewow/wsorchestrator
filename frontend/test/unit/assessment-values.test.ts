/**
 * The arithmetic of an eVals assessment: the stored one-decimal average, the
 * whole number the form shows, and which feedback that whole number requires.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  averageScore,
  isCriterionScore,
  requiredFeedback,
  tracksFor,
  wholeScore,
} from "@/lib/evals/assessment-values";

describe("averageScore", () => {
  test("is null with nothing scored", () => {
    assert.equal(averageScore([]), null);
  });

  test("keeps one decimal place", () => {
    assert.equal(averageScore([4]), 4);
    assert.equal(averageScore([2, 3]), 2.5);
    assert.equal(averageScore([2, 2, 3]), 2.3);
    assert.equal(averageScore([3, 3, 4]), 3.3);
    assert.equal(averageScore([1, 2, 2]), 1.7);
  });

  test("rounds a half up at the second decimal", () => {
    // 3.25 exactly: 4 + 4 + 3 + 2 = 13 over 4.
    assert.equal(averageScore([4, 4, 3, 2]), 3.3);
  });
});

describe("wholeScore and requiredFeedback", () => {
  const cases: [number[], number, ReturnType<typeof requiredFeedback>][] = [
    [[1, 1], 1, "constructive"],
    [[1, 2], 2, "constructive"], // 1.5
    [[2, 2, 3], 2, "constructive"], // 2.3
    [[2, 3], 3, null], // 2.5 shows as 3
    [[3, 3, 4], 3, null], // 3.3
    [[3, 4], 4, "positive"], // 3.5 shows as 4
    [[4, 4], 4, "positive"],
  ];
  for (const [scores, whole, feedback] of cases) {
    test(`${scores.join(", ")} shows ${whole} and requires ${feedback ?? "nothing"}`, () => {
      const average = averageScore(scores)!;
      assert.equal(wholeScore(average), whole);
      assert.equal(requiredFeedback(wholeScore(average)), feedback);
    });
  }
});

test("isCriterionScore takes only 1 to 4, whole", () => {
  for (const ok of [1, 2, 3, 4]) assert.equal(isCriterionScore(ok), true);
  for (const bad of [0, 5, 2.5, "3", null, undefined]) assert.equal(isCriterionScore(bad), false);
});

test("tracksFor never includes deferred or undecided people", () => {
  assert.deepEqual(tracksFor("sales"), ["sales"]);
  assert.deepEqual(tracksFor("engineer"), ["engineer"]);
  assert.deepEqual(tracksFor("both"), ["sales", "engineer"]);
});
