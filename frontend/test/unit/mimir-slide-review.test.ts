/**
 * The slide review's pure parts: every slide must carry 10 to 15 flaws, each
 * on a piece the slide really draws and each actually different from how that
 * piece should look, or a player could click a "mistake" that isn't one.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_SCORE,
  POINTS,
  SLIDES,
  TITLE,
  VERDICTS,
  pointsFor,
  targetsOf,
  verdictFor,
  type Slide,
  type Target,
} from "@/lib/mimir/slide-review/slides";

/** The words a text piece shows when it is right, or undefined for a piece without words. */
function rightText(slide: Slide, target: Target): string | undefined {
  if (target === "title") return TITLE;
  if (target === "subtitle") return slide.subtitle;
  const row = target.match(/^(current|future)\.(\d)\.(head|sub)$/);
  if (row) return slide[row[1] as "current" | "future"][Number(row[2])][row[3] as "head" | "sub"];
  const cap = target.match(/^capability\.(\d+)$/);
  if (cap) return slide.capabilities[Number(cap[1])].lead;
  return undefined;
}

describe("the ten slides", () => {
  test("there are ten, each with its own id", () => {
    assert.equal(SLIDES.length, 10);
    assert.equal(new Set(SLIDES.map((s) => s.id)).size, SLIDES.length);
  });

  for (const slide of SLIDES) {
    describe(slide.id, () => {
      test("has between 10 and 15 flaws", () => {
        assert.ok(slide.flaws.length >= 10 && slide.flaws.length <= 15, `${slide.flaws.length} flaws`);
      });

      test("puts at most one flaw on each piece", () => {
        const targets = slide.flaws.map((f) => f.target);
        assert.equal(new Set(targets).size, targets.length);
      });

      test("puts every flaw on a piece the slide draws", () => {
        const drawn = new Set<Target>(targetsOf(slide));
        for (const f of slide.flaws) {
          if (f.target === "extra") assert.ok(f.extra, "an extra flaw needs something to draw");
          else assert.ok(drawn.has(f.target), `${f.target} is not on the slide`);
        }
      });

      test("makes every flaw look different from the right version", () => {
        for (const f of slide.flaws) {
          if (f.extra) continue;
          assert.ok(Object.keys(f.look).length > 0, `${f.target} changes nothing`);
          if (f.look.text !== undefined) assert.notEqual(f.look.text, rightText(slide, f.target), f.target);
          const cap = f.target.match(/^capability\.(\d+)$/);
          if (cap && f.look.metric !== undefined) assert.notEqual(f.look.metric, slide.capabilities[Number(cap[1])].metric);
        }
      });

      test("explains every flaw", () => {
        for (const f of slide.flaws) assert.ok(f.note.length > 10, f.target);
      });

      test("mixes at least six kinds of mistake", () => {
        assert.ok(new Set(slide.flaws.map((f) => f.kind)).size >= 6);
      });
    });
  }
});

describe("scoring", () => {
  test("a point found, a point lost per wrong click, two per miss", () => {
    assert.deepEqual(POINTS, { found: 1, wrongClick: -1, missed: -2 });
    assert.equal(pointsFor({ found: 10, wrongClicks: 3, missed: 2 }), 3);
  });

  test("the maximum is every flaw found", () => {
    assert.equal(
      MAX_SCORE,
      SLIDES.reduce((n, s) => n + s.flaws.length, 0),
    );
  });

  test("every total gets a verdict, best first", () => {
    assert.equal(verdictFor(MAX_SCORE), VERDICTS[0]);
    assert.equal(verdictFor(-1000), VERDICTS.at(-1));
    for (let i = 1; i < VERDICTS.length; i++) assert.ok(VERDICTS[i].from < VERDICTS[i - 1].from);
  });
});
