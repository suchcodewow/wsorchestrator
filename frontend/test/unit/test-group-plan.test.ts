/** The cohort test group's rules that need no database: its suffix, how it stands in for the cohort, and the channel names. */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { cohortChannels } from "@/lib/cohorts/slack-plan";
import { dedupeMembers, testGroupAsCohort, testGroupSlug } from "@/lib/cohorts/test-group-plan";

describe("testGroupSlug", () => {
  test("makes a Slack-safe suffix", () => {
    assert.equal(testGroupSlug("Smoke Test 2!"), "smoke-test-2");
    assert.equal(testGroupSlug("  --x--  "), "x");
    assert.equal(testGroupSlug("???"), "");
  });
});

describe("testGroupAsCohort", () => {
  test("puts each member in every stage on every track", () => {
    const cohort = testGroupAsCohort([{ email: "A@x.io", fullName: "A" }]);
    assert.equal(cohort.length, 4);
    assert.equal(new Set(cohort.map((m) => `${m.stage}/${m.track}`)).size, 4);
    assert.ok(cohort.every((m) => m.email === "a@x.io"));
  });
});

describe("dedupeMembers", () => {
  test("keeps one of each email, lowercased", () => {
    assert.deepEqual(
      dedupeMembers([
        { email: "A@x.io", fullName: "A" },
        { email: "a@x.io ", fullName: "B" },
      ]),
      [{ email: "a@x.io", fullName: "A" }],
    );
  });
});

describe("cohortChannels with a test suffix", () => {
  test("ends each name with it, and leaves the real names alone without one", () => {
    assert.deepEqual(
      cohortChannels("2026-11-09", false, "smoke").map((c) => c.name),
      ["sales-bootcamp-nov-2026-smoke", "se-bootcamp-nov-2026-smoke"],
    );
    assert.equal(cohortChannels("2026-11-09", false)[0].name, "sales-bootcamp-nov-2026");
  });
});
