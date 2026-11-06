/**
 * The slide review's generator, over thousands of seeds: every slide it makes
 * must keep the promises the game is built on. Between 10 and 15 mistakes,
 * many kinds of them and no kind more than twice, at most one on any piece of
 * the slide (clicking a piece is what fixes it), each one really different
 * from how the piece should look, and the same slide every time from the same
 * seed, since a report or a comment names a slide by its seed alone. The bank
 * its slides are made from must fit the slide too, or a correct line would
 * read as a mistake.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { SLIPS, THEMES } from "@/lib/mimir/slide-review/bank";
import { SEED_MAX, generateSlide, isSeed, newSeed } from "@/lib/mimir/slide-review/generate";
import {
  FLAWS_PER_SLIDE,
  POINTS,
  TITLE,
  VERDICTS,
  maxPointsFor,
  pointsFor,
  targetsOf,
  verdictFor,
  type Slide,
  type Target,
} from "@/lib/mimir/slide-review/slides";

/** Spread across the range, so they aren't all small numbers. */
const SEEDS = Array.from({ length: 3000 }, (_, i) => ((i + 1) * 715_827_883) % SEED_MAX || 1);
const SLIDES = SEEDS.map(generateSlide);

/** The words a text piece shows when it is right, or undefined for a piece without words. */
function rightText(slide: Slide, target: Target): string | undefined {
  if (target === "title") return TITLE;
  if (target === "subtitle") return slide.subtitle;
  if (target === "header.current") return "Current state";
  if (target === "header.future") return "Future state";
  if (target === "capabilitiesTitle") return "Required capabilities";
  const row = target.match(/^(current|future)\.(\d)\.(head|sub)$/);
  if (row) return slide[row[1] as "current" | "future"][Number(row[2])]![row[3] as "head" | "sub"];
  const cap = target.match(/^capability\.(\d+)$/);
  if (cap) return slide.capabilities[Number(cap[1])]!.lead;
  return undefined;
}

describe("a slide made from a seed", () => {
  test("is the same slide every time", () => {
    for (const seed of SEEDS.slice(0, 200)) assert.deepEqual(generateSlide(seed), generateSlide(seed));
  });

  test("differs from the next seed's", () => {
    let same = 0;
    for (const seed of SEEDS.slice(0, 200)) {
      if (JSON.stringify({ ...generateSlide(seed), seed: 0 }) === JSON.stringify({ ...generateSlide(seed + 1), seed: 0 })) same++;
    }
    assert.equal(same, 0);
  });

  test(`has between ${FLAWS_PER_SLIDE.min} and ${FLAWS_PER_SLIDE.max} mistakes, and every count turns up`, () => {
    const counts = new Set<number>();
    for (const s of SLIDES) {
      assert.ok(s.flaws.length >= FLAWS_PER_SLIDE.min && s.flaws.length <= FLAWS_PER_SLIDE.max, `seed ${s.seed}: ${s.flaws.length}`);
      counts.add(s.flaws.length);
    }
    assert.equal(counts.size, FLAWS_PER_SLIDE.max - FLAWS_PER_SLIDE.min + 1);
  });

  test("mixes at least eight kinds of mistake, none more than twice", () => {
    for (const s of SLIDES) {
      const per = new Map<string, number>();
      for (const f of s.flaws) per.set(f.kind, (per.get(f.kind) ?? 0) + 1);
      assert.ok(per.size >= 8, `seed ${s.seed}: ${per.size} kinds`);
      assert.ok(Math.max(...per.values()) <= 2, `seed ${s.seed}`);
    }
  });

  test("deals every kind of mistake, and none far more often than another", () => {
    const per = new Map<string, number>();
    for (const s of SLIDES) for (const f of s.flaws) per.set(f.kind, (per.get(f.kind) ?? 0) + 1);
    assert.equal(per.size, 14);
    const counts = [...per.values()];
    assert.ok(Math.min(...counts) > Math.max(...counts) / 2, JSON.stringify([...per]));
  });

  test("puts at most one mistake on each piece, and only on pieces the slide draws", () => {
    for (const s of SLIDES) {
      const targets = s.flaws.map((f) => f.target);
      assert.equal(new Set(targets).size, targets.length, `seed ${s.seed}`);
      const drawn = new Set<Target>(targetsOf(s));
      for (const f of s.flaws) {
        if (f.target === "extra") assert.ok(f.extra, `seed ${s.seed}: an extra needs something to draw`);
        else assert.ok(drawn.has(f.target), `seed ${s.seed}: ${f.target}`);
      }
    }
  });

  test("makes every mistake look different from the right version, and explains it", () => {
    for (const s of SLIDES) {
      for (const f of s.flaws) {
        assert.ok(f.note.length > 10, `seed ${s.seed}: ${f.target}`);
        if (f.extra) continue;
        assert.ok(Object.keys(f.look).length > 0, `seed ${s.seed}: ${f.target} changes nothing`);
        if (f.look.text !== undefined) assert.notEqual(f.look.text, rightText(s, f.target), `seed ${s.seed}: ${f.target}`);
        const cap = f.target.match(/^capability\.(\d+)$/);
        if (cap && f.look.metric !== undefined) assert.notEqual(f.look.metric, s.capabilities[Number(cap[1])]!.metric);
      }
    }
  });

  test("moves at most one piece of any row", () => {
    const moves = (f: Slide["flaws"][number]) => f.look.dx !== undefined || f.look.dy !== undefined;
    for (const s of SLIDES) {
      const rows = s.flaws.filter((f) => moves(f) && /^(current|future)\.\d\./.test(f.target)).map((f) => f.target.split(".").slice(0, 2).join("."));
      assert.equal(new Set(rows).size, rows.length, `seed ${s.seed}`);
    }
  });

  test("keeps a row's two halves from the same pair, and capabilities from the same theme", () => {
    for (const s of SLIDES.slice(0, 300)) {
      const theme = THEMES.find((t) => t.id === s.theme)!;
      s.current.forEach((row, i) => {
        const pair = theme.pairs.find((p) => p.current.head === row.head);
        assert.ok(pair, `seed ${s.seed}: ${row.head}`);
        assert.deepEqual(pair.future, s.future[i]);
      });
      for (const c of s.capabilities) assert.ok(theme.capabilities.some((t) => t.lead === c.lead));
      assert.ok(s.capabilities.length === 4 || s.capabilities.length === 5);
    }
  });
});

describe("the bank", () => {
  // Rough widths in the slide's own pixels, at the widest font a mistake can set a line in.
  const fits = (text: string, max: number) => text.length <= max;

  test("has themes with enough pairs and capabilities to vary", () => {
    assert.ok(THEMES.length >= 10);
    assert.equal(new Set(THEMES.map((t) => t.id)).size, THEMES.length);
    for (const t of THEMES) {
      assert.ok(t.pairs.length >= 7, t.id);
      assert.ok(t.capabilities.length >= 5, t.id);
    }
  });

  test("fits every phrase in its column, even a size or font off", () => {
    for (const t of THEMES) {
      for (const p of t.pairs) {
        for (const row of [p.current, p.future]) {
          assert.ok(fits(row.head, 44), `${t.id}: “${row.head}” (${row.head.length})`);
          assert.ok(fits(row.sub, 54), `${t.id}: “${row.sub}” (${row.sub.length})`);
        }
      }
      for (const c of t.capabilities) assert.ok(fits(`${c.lead} → ${c.metric}`, 95), `${t.id}: ${c.lead}`);
      assert.ok(fits(t.subtitle, 95), t.id);
    }
  });

  test("names each phrase only once in a theme", () => {
    for (const t of THEMES) {
      const lines = t.pairs.flatMap((p) => [p.current.head, p.current.sub, p.future.head, p.future.sub]);
      assert.equal(new Set(lines).size, lines.length, t.id);
    }
  });

  test("keys every slip to a phrase it has, with a version that differs and runs long only on a headline", () => {
    const heads = new Set(THEMES.flatMap((t) => t.pairs.flatMap((p) => [p.current.head, p.future.head])));
    const lines = new Set(THEMES.flatMap((t) => t.pairs.flatMap((p) => [p.current.head, p.current.sub, p.future.head, p.future.sub])));
    for (const [phrase, slip] of Object.entries(SLIPS)) {
      assert.ok(lines.has(phrase), `“${phrase}” is not in the bank`);
      if (slip.grammar) assert.notEqual(slip.grammar[0], phrase);
      if (slip.long) {
        assert.ok(heads.has(phrase), `“${phrase}” runs long but is not a headline`);
        assert.ok(slip.long.length >= 70, `“${slip.long}” is not long enough to run over`);
      }
    }
  });
});

describe("seeds", () => {
  test("are whole numbers from 1 to the most a Postgres integer holds", () => {
    assert.equal(isSeed(1), true);
    assert.equal(isSeed(SEED_MAX), true);
    for (const bad of [0, -1, SEED_MAX + 1, 1.5, "1", null]) assert.equal(isSeed(bad), false);
    for (let i = 0; i < 100; i++) assert.equal(isSeed(newSeed()), true);
  });
});

describe("scoring", () => {
  test("a point found, a point lost per wrong click, two per miss", () => {
    assert.deepEqual(POINTS, { found: 1, wrongClick: -1, missed: -2 });
    assert.equal(pointsFor({ found: 10, wrongClicks: 3, missed: 2 }), 3);
  });

  test("the most a slide allows is every mistake found", () => {
    const s = SLIDES[0]!;
    assert.equal(maxPointsFor(s), s.flaws.length);
    assert.equal(pointsFor({ found: s.flaws.length, wrongClicks: 0, missed: 0 }), maxPointsFor(s));
  });

  test("every total gets a verdict, best first", () => {
    assert.equal(verdictFor(30, 30), VERDICTS[0]);
    assert.equal(verdictFor(-1000, 30), VERDICTS.at(-1));
    for (let i = 1; i < VERDICTS.length; i++) assert.ok(VERDICTS[i]!.from < VERDICTS[i - 1]!.from);
  });
});
