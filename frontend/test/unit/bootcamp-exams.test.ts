/**
 * The entrance and exit exams on Reporting → Live Sessions: their average,
 * which needs both, and where that average falls on the 1 to 4 scale.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { examAverage, examScore } from "@/lib/reporting/bootcamp-values";

describe("examAverage", () => {
  test("is null until both exams are in", () => {
    assert.equal(examAverage(null, null), null);
    assert.equal(examAverage(90, null), null);
    assert.equal(examAverage(null, 90), null);
  });

  test("is the mean of the two, to one decimal place", () => {
    assert.equal(examAverage(80, 90), 85);
    assert.equal(examAverage(91, 94), 92.5);
    assert.equal(examAverage(90.3, 90), 90.2);
    assert.equal(examAverage(0, 0), 0);
  });
});

describe("examScore", () => {
  test("is 4 from 96%, 3 from 88%, 2 from 80%, and 1 below", () => {
    assert.equal(examScore(100), 4);
    assert.equal(examScore(96), 4);
    assert.equal(examScore(95.5), 3);
    assert.equal(examScore(88), 3);
    assert.equal(examScore(87.9), 2);
    assert.equal(examScore(80), 2);
    assert.equal(examScore(79.5), 1);
    assert.equal(examScore(0), 1);
  });
});
