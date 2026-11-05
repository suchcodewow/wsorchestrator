/**
 * What a finished run of a hands-on experience may report. The experiences
 * run in the browser, so this is the only check a score gets before it is
 * kept as someone's best.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { EXPERIENCE_IDS, SLIDE_SCORE_FLOOR, parseExperienceRun } from "@/lib/mimir/experiences";
import { MAX_SCORE as SECURITY_MAX } from "@/lib/mimir/security-game/scenario";
import { SLIDES } from "@/lib/mimir/slide-review/slides";

describe("a run of the Developer experience", () => {
  test("is only that it was finished", () => {
    assert.deepEqual(parseExperienceRun({ experience: "developer" }), { experience: "developer", part: "", score: null });
  });

  test("takes no score and no part", () => {
    assert.equal(parseExperienceRun({ experience: "developer", score: 3 }), null);
    assert.equal(parseExperienceRun({ experience: "developer", part: "x" }), null);
  });
});

describe("a run of the Enterprise Security Team", () => {
  test("reports its total, from 0 to the game's maximum", () => {
    assert.deepEqual(parseExperienceRun({ experience: "security", score: 0 }), { experience: "security", part: "", score: 0 });
    assert.equal(parseExperienceRun({ experience: "security", score: SECURITY_MAX })?.score, SECURITY_MAX);
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
  const slide = SLIDES[0];

  test("names a real slide and scores at most its number of mistakes", () => {
    assert.deepEqual(parseExperienceRun({ experience: "slide-review", part: slide.id, score: slide.flaws.length }), {
      experience: "slide-review",
      part: slide.id,
      score: slide.flaws.length,
    });
    assert.equal(parseExperienceRun({ experience: "slide-review", part: slide.id, score: slide.flaws.length + 1 }), null);
    assert.equal(parseExperienceRun({ experience: "slide-review", part: "no-such-slide", score: 1 }), null);
    assert.equal(parseExperienceRun({ experience: "slide-review", score: 1 }), null);
  });

  test("can go negative, down to the floor", () => {
    assert.equal(parseExperienceRun({ experience: "slide-review", part: slide.id, score: SLIDE_SCORE_FLOOR })?.score, SLIDE_SCORE_FLOOR);
    assert.equal(parseExperienceRun({ experience: "slide-review", part: slide.id, score: SLIDE_SCORE_FLOOR - 1 }), null);
  });
});

describe("anything else", () => {
  test("is not a run", () => {
    for (const body of [null, undefined, "developer", 3, [], {}, { experience: "chat" }]) assert.equal(parseExperienceRun(body), null);
  });

  test("the schema's check names the same experiences", () => {
    assert.deepEqual([...EXPERIENCE_IDS], ["developer", "security", "slide-review"]);
  });
});
