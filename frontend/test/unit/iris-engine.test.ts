/**
 * The Iris engine and question bank.
 *
 * The accuracy floors are Project Iris's own measurements of this engine
 * (84% of true Beginners, 88% of Intermediates and 92% of Advanced placed
 * correctly, 96% of blind guessers floored at Beginner), less a couple of points
 * of simulation noise. A change that drops below one is a change to how people
 * are placed, not a refactor. The simulations are seeded, so they give the
 * same numbers on every run.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  ENGINE,
  confidenceOf,
  drawItem,
  newRunState,
  placementOf,
  submit,
  type Asked,
  type Level,
} from "@/lib/iris/engine";
import { IRIS_ITEMS } from "@/lib/iris/items";
import { SUBJECT_KEYS, TRACKS, TRACK_WEIGHTS, compositeOf, isSubjectKey } from "@/lib/iris/subjects";
import { PROFILES, longestOption, runOnce, seeded } from "../support/iris-sim";

const RUNS = 2000;
const poolOf = (subject: string) => IRIS_ITEMS.filter((i) => i.subject === subject && i.form === "A");

const asked = (level: Level, correct: boolean, n: number, from = 0): Asked[] =>
  Array.from({ length: n }, (_, k) => ({ id: `q${level}-${from + k}`, level, subtopic: `s${k}`, correct, phase: "main" }));

describe("the bank", () => {
  test("is 304 questions, each id once", () => {
    assert.equal(IRIS_ITEMS.length, 304);
    assert.equal(new Set(IRIS_ITEMS.map((i) => i.id)).size, 304);
  });

  test("every subject has 12 Beginner, 14 Intermediate and 12 Advanced on Form A", () => {
    for (const s of SUBJECT_KEYS) {
      const pool = poolOf(s);
      assert.deepEqual(
        [1, 2, 3].map((l) => pool.filter((i) => i.level === l).length),
        [12, 14, 12],
        s,
      );
    }
  });

  test("every question has four different options, a keyed answer, an explanation and a known subject", () => {
    const wrong = IRIS_ITEMS.filter(
      (i) =>
        !isSubjectKey(i.subject) ||
        i.options.length !== 4 ||
        new Set(i.options).size !== 4 ||
        ![0, 1, 2, 3].includes(i.answer) ||
        !i.rationale.trim() ||
        !i.stem.trim() ||
        !i.subtopic,
    ).map((i) => i.id);
    assert.deepEqual(wrong, []);
  });

  test("every subject holds enough questions for the longest possible run", () => {
    for (const s of SUBJECT_KEYS) assert.ok(poolOf(s).length >= ENGINE.MAX + ENGINE.TIE_N, s);
  });
});

describe("the rules", () => {
  test("a run starts at Intermediate", () => {
    assert.equal(newRunState().level, 2);
    const first = drawItem(poolOf("sdlc"), [], ENGINE.START, seeded(1));
    assert.equal(first?.level, 2);
  });

  test("two right in a row moves up, two wrong in a row moves down", () => {
    const pool = poolOf("sdlc");
    const random = seeded(2);
    let state = newRunState();
    const history: Asked[] = [];
    let item = drawItem(pool, history, state.level, random)!;
    for (const correct of [true, true]) {
      const step = submit(state, history, item, correct, pool, random);
      history.push({ id: item.id, level: item.level, subtopic: item.subtopic, correct, phase: step.phase });
      state = step.state;
      item = step.next!;
    }
    assert.equal(state.level, 3);
    for (const correct of [false, false]) {
      const step = submit(state, history, item, correct, pool, random);
      history.push({ id: item.id, level: item.level, subtopic: item.subtopic, correct, phase: step.phase });
      state = step.state;
      item = step.next!;
    }
    assert.equal(state.level, 2);
  });

  test("placement is the highest level with three or more asked and two thirds right", () => {
    assert.equal(placementOf([...asked(1, true, 3), ...asked(2, true, 2), ...asked(2, false, 1)]), 2);
    assert.equal(placementOf([...asked(3, true, 2), ...asked(3, false, 1), ...asked(2, true, 3)]), 3);
    assert.equal(placementOf(asked(3, true, 2)), 1, "two right at Advanced is too few to place there");
    assert.equal(placementOf(asked(2, false, 5)), 1, "nothing clears the bar, so Beginner");
  });

  test("confidence is high only with four or more at the placed level and three quarters right", () => {
    assert.equal(confidenceOf(asked(2, true, 4)), "high");
    assert.equal(confidenceOf([...asked(2, true, 2), ...asked(2, false, 1)]), "medium");
    assert.equal(confidenceOf(asked(2, false, 4)), "low");
  });

  test("never repeats a question, and never runs past 14 plus the tiebreak", () => {
    for (const s of SUBJECT_KEYS) {
      const random = seeded(3);
      for (let r = 0; r < 300; r++) {
        const { asked: run } = runOnce(poolOf(s), () => random() < 0.6, random);
        assert.equal(new Set(run.map((a) => a.id)).size, run.length, s);
        assert.ok(run.length >= ENGINE.MIN && run.length <= ENGINE.MAX + ENGINE.TIE_N, `${s}: ${run.length}`);
      }
    }
  });

  test("avoids a third question in a row from one subtopic when another is available", () => {
    const pool = [
      { id: "a1", level: 2 as const, subtopic: "a" },
      { id: "a2", level: 2 as const, subtopic: "a" },
      { id: "b1", level: 2 as const, subtopic: "b" },
    ];
    const history: Asked[] = [
      { id: "x", level: 2, subtopic: "a", correct: true, phase: "main" },
      { id: "y", level: 2, subtopic: "a", correct: true, phase: "main" },
    ];
    assert.equal(drawItem(pool, history, 2, seeded(4))?.id, "b1");
  });
});

describe("placement accuracy against simulated takers", () => {
  const expected = { beginner: 1, intermediate: 2, advanced: 3, guesser: 1 } as const;
  const floor = { beginner: 0.82, intermediate: 0.86, advanced: 0.9, guesser: 0.94 } as const;

  for (const s of SUBJECT_KEYS) {
    test(s, () => {
      const pool = poolOf(s);
      const missed: string[] = [];
      for (const [name, p] of Object.entries(PROFILES) as [keyof typeof PROFILES, readonly number[]][]) {
        const random = seeded(7);
        let hits = 0;
        for (let r = 0; r < RUNS; r++) {
          const { placement } = runOnce(pool, (item) => random() < p[item.level - 1]!, random);
          if (placement === expected[name]) hits++;
        }
        if (hits / RUNS < floor[name]) missed.push(`${name}: ${((hits / RUNS) * 100).toFixed(1)}%`);
      }
      assert.deepEqual(missed, []);
    });
  }
});

describe("answer-length shortcuts", () => {
  test("always picking the longest option never places anyone Advanced", () => {
    for (const s of SUBJECT_KEYS) {
      const random = seeded(5);
      let advanced = 0;
      for (let r = 0; r < RUNS; r++) {
        if (runOnce(poolOf(s), (item) => longestOption(item) === item.answer, random).placement === 3) advanced++;
      }
      assert.equal(advanced, 0, s);
    }
  });
});

describe("the overall score", () => {
  test("every track's weights add to 100", () => {
    for (const t of TRACKS) {
      assert.equal(Object.values(TRACK_WEIGHTS[t]).reduce((a, b) => a + b, 0), 100, t);
    }
  });

  test("weights the subjects placed so far, and ignores a subject the track gives no weight", () => {
    assert.equal(compositeOf({}, "AE"), null);
    assert.equal(compositeOf({ sales: 3, dealmech: 3 }, "AE"), 100);
    assert.equal(compositeOf({ sales: 3, dealmech: 1 }, "AE"), 67);
    assert.equal(compositeOf({ pipegen: 3 }, "SE"), null, "Pipegen carries no weight for an SE");
  });
});
