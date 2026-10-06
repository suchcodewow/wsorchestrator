/** Simulated Iris takers, for checking the engine against the real bank. */

import { ENGINE, drawItem, newRunState, placementOf, submit, type Asked, type IrisItem, type Level } from "@/lib/iris/engine";

/** A small seeded generator, so a simulation gives the same numbers every run. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Chance of answering right at Beginner, Intermediate and Advanced. The profiles Project Iris was tuned against. */
export const PROFILES = {
  beginner: [0.85, 0.4, 0.2],
  intermediate: [0.95, 0.8, 0.35],
  advanced: [0.97, 0.92, 0.8],
  guesser: [0.25, 0.25, 0.25],
} as const satisfies Record<string, readonly [number, number, number]>;

/** One whole run: `answers` says whether each question shown is answered right. */
export function runOnce(
  pool: readonly IrisItem[],
  answers: (item: IrisItem) => boolean,
  random: () => number,
): { placement: Level; asked: Asked[] } {
  let state = newRunState();
  const asked: Asked[] = [];
  let item = drawItem(pool, asked, ENGINE.START, random);
  for (let guard = 0; item; guard++) {
    if (guard > 100) throw new Error("runaway run");
    const correct = answers(item);
    const step = submit(state, asked, item, correct, pool, random);
    asked.push({ id: item.id, level: item.level, subtopic: item.subtopic, correct, phase: step.phase });
    state = step.state;
    item = step.next;
  }
  return { placement: placementOf(asked), asked };
}

/** The option with the most words: what a taker who knows nothing but reads length would pick. */
export const longestOption = (item: IrisItem) => {
  const words = item.options.map((o) => o.trim().split(/\s+/).length);
  return words.indexOf(Math.max(...words));
};
