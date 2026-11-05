/**
 * The Enterprise Security Team game's pure parts: the three months' builds
 * must add up to the totals the in-person deck announced, and the scoring and
 * review tiers must cover every possible result.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  BUILDS_PER_PAGE,
  MAX_SCORE,
  REVIEWS,
  ROUNDS,
  actualCount,
  isVulnerable,
  pointsFor,
  reviewFor,
  rulesInForce,
  whyVulnerable,
  type Build,
} from "@/lib/mimir/security-game/scenario";

const build = (id: string, packages: string, color: Build["color"] = "plain"): Build => ({
  id,
  packages: packages.split(" ") as Build["packages"],
  color,
});

describe("the three months", () => {
  test("every page holds a full grid", () => {
    for (const round of ROUNDS) {
      for (const page of round.pages) assert.equal(page.length, BUILDS_PER_PAGE);
    }
  });

  test("the page counts are the deck's: 3, 5 and 7", () => {
    assert.deepEqual(
      ROUNDS.map((r) => r.pages.length),
      [3, 5, 7],
    );
  });

  test("the actual counts are the deck's: 16, 29 and 45", () => {
    assert.deepEqual(ROUNDS.map(actualCount), [16, 29, 45]);
  });

  test("each month's sample builds show a build that breaks a rule and one that doesn't", () => {
    for (const round of ROUNDS) {
      const flags = round.examples.map((e) => isVulnerable(e, round.number));
      assert.ok(flags.includes(true) && flags.includes(false), `month ${round.number}`);
    }
  });
});

describe("the rules", () => {
  test("a P in any package breaks rule one, and the word PACKAGES doesn't count", () => {
    assert.equal(isVulnerable(build("run-293-7m", "power fortress penguin"), 1), true);
    assert.equal(isVulnerable(build("cat-847-3x", "thunder lightning banana"), 1), false);
  });

  test("blue builds with an even first digit break rule two, but only from month two", () => {
    const even = build("cat-847-3x", "thunder lightning bunny", "blue");
    assert.equal(isVulnerable(even, 1), false);
    assert.equal(isVulnerable(even, 2), true);
    assert.equal(isVulnerable(build("run-393-7m", "lower fortress crow", "blue"), 2), false);
    assert.equal(isVulnerable(build("cat-847-3x", "thunder lightning bunny", "green"), 2), false);
  });

  test("red builds need both git and lab, in one package or two, and only from month three", () => {
    const both = build("cat-111-3x", "gitirdone lightning labrador", "red");
    assert.equal(isVulnerable(both, 2), false);
    assert.equal(isVulnerable(both, 3), true);
    assert.equal(isVulnerable(build("cat-111-3x", "legitimize blender belabor", "red"), 3), true);
    assert.equal(isVulnerable(build("cat-111-3x", "labrador fortress crow", "red"), 3), false);
    assert.equal(isVulnerable(build("cat-111-3x", "gitirdone lightning labrador", "blue"), 3), false);
  });

  test("a build that breaks two rules says why twice", () => {
    assert.equal(whyVulnerable(build("cat-847-3x", "thunder lightning apple", "blue"), 2).length, 2);
  });

  test("the rules pile up month by month", () => {
    assert.deepEqual(
      [1, 2, 3].map((n) => rulesInForce(n as 1 | 2 | 3).length),
      [1, 2, 3],
    );
  });
});

describe("scoring", () => {
  test("10 for the exact count, 5 one off, 2 two off, then nothing", () => {
    assert.deepEqual(
      [16, 15, 17, 14, 18, 13, 19, 0].map((n) => pointsFor(n, 16)),
      [10, 5, 5, 2, 2, 0, 0, 0],
    );
  });

  test("the maximum is 30", () => {
    assert.equal(MAX_SCORE, 30);
  });
});

describe("the performance review", () => {
  test("every total from 0 to 30 lands in exactly one tier", () => {
    for (let total = 0; total <= MAX_SCORE; total++) {
      assert.equal(REVIEWS.filter((r) => total >= r.from && total <= r.to).length, 1, `total ${total}`);
    }
  });

  test("the tiers' edges", () => {
    assert.equal(reviewFor(0).title, "Surprise meeting with HR");
    assert.equal(reviewFor(10).title, "Surprise meeting with HR");
    assert.equal(reviewFor(11).title, "Performance Improvement Plan");
    assert.equal(reviewFor(27).title, "Meets Expectations");
    assert.equal(reviewFor(28).pizza, true);
  });
});
