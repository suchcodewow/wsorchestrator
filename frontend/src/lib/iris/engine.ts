/**
 * The Iris adaptive placement engine, ported from Project Iris with its
 * simulation-validated parameters unchanged: start at Intermediate, two right
 * in a row moves up a level and two wrong moves down, 10 to 14 questions, then
 * up to 3 tiebreak questions when the level above the placement sits between
 * 45 and 66 percent.
 *
 * Pure: the answer history is passed in rather than held, so the server can
 * rebuild a run from its stored responses on every answer. Nothing here knows
 * an answer key; the caller grades and passes `correct`.
 */

import type { SubjectKey } from "@/lib/iris/subjects";

export const ENGINE = {
  START: 2,
  MIN: 10,
  MAX: 14,
  UP: 2,
  DOWN: 2,
  TIE_N: 3,
  TIE_LO: 0.45,
  BAR: 2 / 3,
  MIN_AT_LEVEL: 3,
} as const;

export const LEVELS = [1, 2, 3] as const;
export type Level = (typeof LEVELS)[number];

export const FORMS = ["A", "B"] as const;
export type Form = (typeof FORMS)[number];

export function isForm(value: unknown): value is Form {
  return FORMS.includes(value as Form);
}

/**
 * "I don't know", recorded as its own choice so a gap in knowledge can be told
 * from a misconception. Graded exactly like a wrong answer, so it is never the
 * cheaper route to a high placement.
 */
export const IDK = -1;

export type IrisItem = {
  id: string;
  subject: SubjectKey;
  form: Form;
  level: Level;
  subtopic: string;
  version: string;
  stem: string;
  options: readonly [string, string, string, string];
  answer: 0 | 1 | 2 | 3;
  rationale: string;
};

export type Phase = "main" | "tiebreak";

/** One answered question, as much of it as the engine needs. */
export type Asked = { id: string; level: Level; subtopic: string; correct: boolean; phase: Phase };

/** Where a run is between questions. */
export type RunState = { level: Level; up: number; down: number; phase: Phase; tieLeft: number };

export type Confidence = "high" | "medium" | "low";

export const newRunState = (): RunState => ({ level: ENGINE.START, up: 0, down: 0, phase: "main", tieLeft: 0 });

const attemptsAt = (asked: readonly Asked[], lv: Level) => asked.filter((a) => a.level === lv).length;
const correctAt = (asked: readonly Asked[], lv: Level) => asked.filter((a) => a.level === lv && a.correct).length;
function accAt(asked: readonly Asked[], lv: Level): number {
  const n = attemptsAt(asked, lv);
  return n ? correctAt(asked, lv) / n : 0;
}

/** The highest level with enough questions asked and two thirds of them right, otherwise Beginner. */
export function placementOf(asked: readonly Asked[]): Level {
  for (const lv of [3, 2, 1] as const) {
    if (attemptsAt(asked, lv) >= ENGINE.MIN_AT_LEVEL && accAt(asked, lv) >= ENGINE.BAR) return lv;
  }
  return 1;
}

export function confidenceOf(asked: readonly Asked[]): Confidence {
  const lv = placementOf(asked);
  const n = attemptsAt(asked, lv);
  const acc = accAt(asked, lv);
  if (n >= 4 && acc >= 0.75) return "high";
  if (n >= ENGINE.MIN_AT_LEVEL && acc >= ENGINE.BAR) return "medium";
  return "low";
}

/** The next question: the asked-for level, not already asked, and not a third in a row from one subtopic. Falls back level by level so a thin bank degrades instead of dead-ending. */
export function drawItem<T extends Pick<IrisItem, "id" | "level" | "subtopic">>(
  pool: readonly T[],
  asked: readonly Asked[],
  level: Level,
  random: () => number = Math.random,
): T | null {
  const askedIds = new Set(asked.map((a) => a.id));
  const last = asked.slice(-2);
  const twoSame = last.length === 2 && last[0]!.subtopic === last[1]!.subtopic ? last[0]!.subtopic : null;
  const order = [level, level - 1, level + 1, level - 2, level + 2].filter((l): l is Level => l >= 1 && l <= 3);
  for (const lv of order) {
    let candidates = pool.filter((i) => i.level === lv && !askedIds.has(i.id));
    if (twoSame) {
      const relaxed = candidates.filter((i) => i.subtopic !== twoSame);
      if (relaxed.length) candidates = relaxed;
    }
    if (candidates.length) return candidates[Math.floor(random() * candidates.length)]!;
  }
  return null;
}

function settled(asked: readonly Asked[]): boolean {
  const placed = placementOf(asked);
  if (attemptsAt(asked, placed) < 4) return false;
  if (placed === 3) return accAt(asked, 3) >= 0.75;
  const above = (placed + 1) as Level;
  return attemptsAt(asked, above) >= ENGINE.MIN_AT_LEVEL && accAt(asked, above) < 0.5;
}

function tiebreakLevel(asked: readonly Asked[]): Level | null {
  const placed = placementOf(asked);
  if (placed >= 3) return null;
  const above = (placed + 1) as Level;
  if (attemptsAt(asked, above) < ENGINE.MIN_AT_LEVEL) return null;
  const acc = accAt(asked, above);
  return acc >= ENGINE.TIE_LO && acc < ENGINE.BAR ? above : null;
}

/**
 * Records one graded answer and picks what comes next. `asked` is the history
 * before this answer; `item` is the question just answered. Returns the new
 * state, the phase the answer belongs to, and the next question or null when
 * the run is over.
 */
export function submit<T extends Pick<IrisItem, "id" | "level" | "subtopic">>(
  state: RunState,
  asked: readonly Asked[],
  item: T,
  correct: boolean,
  pool: readonly T[],
  random: () => number = Math.random,
): { state: RunState; phase: Phase; next: T | null } {
  const phase = state.phase;
  const after: Asked[] = [...asked, { id: item.id, level: item.level, subtopic: item.subtopic, correct, phase }];
  const s: RunState = { ...state };

  if (s.phase === "main") {
    if (correct) {
      s.up++;
      s.down = 0;
      if (s.up >= ENGINE.UP && s.level < 3) {
        s.level = (s.level + 1) as Level;
        s.up = 0;
      }
    } else {
      s.down++;
      s.up = 0;
      if (s.down >= ENGINE.DOWN && s.level > 1) {
        s.level = (s.level - 1) as Level;
        s.down = 0;
      }
    }
    const n = after.length;
    const done = n >= ENGINE.MAX || (n >= ENGINE.MIN && settled(after));
    if (!done) {
      const next = drawItem(pool, after, s.level, random);
      if (next) return { state: s, phase, next };
    }
    const tie = tiebreakLevel(after);
    if (tie) {
      const next = drawItem(pool, after, tie, random);
      if (next) return { state: { ...s, phase: "tiebreak", tieLeft: ENGINE.TIE_N - 1, level: tie }, phase, next };
    }
    return { state: s, phase, next: null };
  }

  if (s.tieLeft > 0) {
    const next = drawItem(pool, after, s.level, random);
    if (next) return { state: { ...s, tieLeft: s.tieLeft - 1 }, phase, next };
  }
  return { state: s, phase, next: null };
}
