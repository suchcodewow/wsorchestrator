/**
 * What a finished run of a hands-on experience may report. The experiences
 * run in the browser, so this is the only check a run gets before it is kept.
 * A slide of the slide review is rebuilt here from its seed, and its score
 * worked out here too, so the browser can't claim more than the slide had.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { EXPERIENCE_IDS, WRONG_CLICKS_MAX, parseExperienceRun } from "@/lib/mimir/experiences";
import { MAX_SCORE as SECURITY_MAX } from "@/lib/mimir/security-game/scenario";
import { SEED_MAX, generateSlide } from "@/lib/mimir/slide-review/generate";
import { pointsFor } from "@/lib/mimir/slide-review/slides";

describe("a run of the Developer experience", () => {
  test("is only that it was finished", () => {
    assert.deepEqual(parseExperienceRun({ experience: "developer" }), { experience: "developer", score: null });
  });

  test("takes no score", () => {
    assert.equal(parseExperienceRun({ experience: "developer", score: 3 }), null);
  });
});

describe("a run of the Enterprise Security Team", () => {
  test("reports its total, from 0 to the game's maximum", () => {
    assert.deepEqual(parseExperienceRun({ experience: "security", score: 0 }), { experience: "security", score: 0 });
    assert.equal(parseExperienceRun({ experience: "security", score: SECURITY_MAX })?.experience, "security");
    assert.equal(parseExperienceRun({ experience: "security", score: SECURITY_MAX + 1 }), null);
    assert.equal(parseExperienceRun({ experience: "security", score: -1 }), null);
  });

  test("needs a whole-number score", () => {
    assert.equal(parseExperienceRun({ experience: "security" }), null);
    assert.equal(parseExperienceRun({ experience: "security", score: 2.5 }), null);
    assert.equal(parseExperienceRun({ experience: "security", score: "10" }), null);
  });
});

describe("a slide of the slide review", () => {
  const seed = 123_456;
  const slide = generateSlide(seed);
  const total = slide.flaws.length;

  test("is rebuilt from its seed, and scored here", () => {
    const run = parseExperienceRun({ experience: "slide-review", seed, found: total - 2, wrongClicks: 3 });
    assert.deepEqual(run, {
      experience: "slide-review",
      seed,
      theme: slide.theme,
      found: total - 2,
      total,
      wrongClicks: 3,
      score: pointsFor({ found: total - 2, wrongClicks: 3, missed: 2 }),
    });
  });

  test("ignores a score the browser sends", () => {
    const run = parseExperienceRun({ experience: "slide-review", seed, found: 0, wrongClicks: 0, score: 999 });
    assert.equal(run?.experience === "slide-review" && run.score, -2 * total);
  });

  test("can't find more mistakes than the slide had", () => {
    assert.equal(parseExperienceRun({ experience: "slide-review", seed, found: total + 1, wrongClicks: 0 }), null);
  });

  test("needs a real seed and sensible counts", () => {
    for (const bad of [0, SEED_MAX + 1, 1.5, "7"]) {
      assert.equal(parseExperienceRun({ experience: "slide-review", seed: bad, found: 1, wrongClicks: 0 }), null);
    }
    assert.equal(parseExperienceRun({ experience: "slide-review", seed, found: -1, wrongClicks: 0 }), null);
    assert.equal(parseExperienceRun({ experience: "slide-review", seed, found: 1, wrongClicks: WRONG_CLICKS_MAX + 1 }), null);
    assert.equal(parseExperienceRun({ experience: "slide-review", seed, found: 1 }), null);
  });
});

describe("anything else", () => {
  test("is not a run", () => {
    for (const body of [null, undefined, "developer", 3, [], {}, { experience: "chat" }]) assert.equal(parseExperienceRun(body), null);
  });

  test("names the experiences the schema allows", () => {
    assert.deepEqual([...EXPERIENCE_IDS], ["developer", "security", "slide-review"]);
  });
});
