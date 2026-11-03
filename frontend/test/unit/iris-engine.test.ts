/**
 * The Diagnostic engine and question bank.
 *
 * The accuracy floors are Project Iris's own measurements of this engine
 * (84% of true 101s, 88% of 201s and 92% of 301s placed correctly, 96% of
 * blind guessers floored at 101), less a couple of points of simulation
 * noise. The October 2026 bank measures the same in every subject. A change that drops below one is a change to how people
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
import {
  OPEN_SUBJECT_KEYS,
  SUBJECTS,
  SUBJECT_KEYS,
  TRACKS,
  TRACK_WEIGHTS,
  compositeOf,
  isSubjectKey,
} from "@/lib/iris/subjects";
import { PROFILES, longestOption, runOnce, seeded } from "../support/iris-sim";

const RUNS = 2000;
const poolOf = (subject: string) => IRIS_ITEMS.filter((i) => i.subject === subject && i.form === "A");

const asked = (level: Level, correct: boolean, n: number, from = 0): Asked[] =>
  Array.from({ length: n }, (_, k) => ({ id: `q${level}-${from + k}`, level, subtopic: `s${k}`, correct, phase: "main" }));

describe("the bank", () => {
  test("is 190 questions, each id once, all version 3.0", () => {
    assert.equal(IRIS_ITEMS.length, 190);
    assert.equal(new Set(IRIS_ITEMS.map((i) => i.id)).size, 190);
    assert.ok(IRIS_ITEMS.every((i) => i.version === "3.0"));
  });

  test("the subjects marked coming soon are exactly the ones with no questions", () => {
    for (const s of SUBJECT_KEYS) {
      assert.equal(SUBJECTS[s].comingSoon, poolOf(s).length === 0, s);
    }
    assert.deepEqual([...OPEN_SUBJECT_KEYS], ["sdlc", "companies", "aisdlc", "pipegen", "champion"]);
  });

  test("every subject with questions has 12 at 101, 14 at 201 and 12 at 301 on Form A", () => {
    for (const s of OPEN_SUBJECT_KEYS) {
      const pool = poolOf(s);
      assert.deepEqual(
        [1, 2, 3].map((l) => pool.filter((i) => i.level === l).length),
        [12, 14, 12],
        s,
      );
    }
  });

  test("every question has four different options, a keyed answer, a stem, a subtopic and a known subject", () => {
    const wrong = IRIS_ITEMS.filter(
      (i) =>
        !isSubjectKey(i.subject) ||
        i.options.length !== 4 ||
        new Set(i.options).size !== 4 ||
        ![0, 1, 2, 3].includes(i.answer) ||
        !i.stem.trim() ||
        !i.subtopic,
    ).map((i) => i.id);
    assert.deepEqual(wrong, []);
  });

  test("every subject with questions holds enough for the longest possible run", () => {
    for (const s of OPEN_SUBJECT_KEYS) assert.ok(poolOf(s).length >= ENGINE.MAX + ENGINE.TIE_N, s);
  });
});

describe("the rules", () => {
  test("a run starts at 201", () => {
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
    for (const s of OPEN_SUBJECT_KEYS) {
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

  for (const s of OPEN_SUBJECT_KEYS) {
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
  // The October 2026 bank lets this through about 1 time in 2,000 in Champion
  // Building, where the key is the longest option in 26% of questions; the
  // earlier bank never did. Past 1 in 1,000 the lengths give the answer away.
  test("always picking the longest option almost never places anyone at 301", () => {
    const runs = 20_000;
    for (const s of OPEN_SUBJECT_KEYS) {
      const random = seeded(5);
      let top = 0;
      for (let r = 0; r < runs; r++) {
        if (runOnce(poolOf(s), (item) => longestOption(item) === item.answer, random).placement === 3) top++;
      }
      assert.ok(top / runs < 0.001, `${s}: ${top} of ${runs}`);
    }
  });
});

describe("the overall score", () => {
  test("every subject counts the same for every track, for now", () => {
    for (const t of TRACKS) {
      assert.deepEqual(new Set(Object.values(TRACK_WEIGHTS[t])), new Set([1]), t);
      assert.deepEqual(Object.keys(TRACK_WEIGHTS[t]).sort(), [...SUBJECT_KEYS].sort(), t);
    }
  });

  test("is the share of the top level reached across the subjects placed so far", () => {
    assert.equal(compositeOf({}, "AE"), null);
    assert.equal(compositeOf({ sdlc: 3, champion: 3 }, "AE"), 100);
    assert.equal(compositeOf({ sdlc: 3, champion: 1 }, "SE"), 67);
    assert.equal(compositeOf({ sdlc: 1, companies: 2, aisdlc: 3 }, "SDR"), 67);
  });
});
