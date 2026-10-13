export const FPS = 30;

export type SceneTiming = {
  key: string;
  text: string;
  hash: string;
  audio: string; // path relative to public/
  duration: number; // seconds of narration
  characters: string[];
  starts: number[];
  ends: number[];
};
export type VideoTiming = { id: string; scenes: SceneTiming[] };

export const LEAD_SECONDS = 0.4; // silence before narration starts in each scene
export const TAIL_SECONDS = 0.9; // pause after narration
export const FINAL_TAIL_SECONDS = 2.2;

const spoken = (scene: SceneTiming) => scene.characters.join("");

function findPhrase(scene: SceneTiming, phrase: string, nth: number): number {
  const hay = spoken(scene).toLowerCase();
  const needle = phrase.toLowerCase();
  let idx = -1;
  for (let i = 0; i <= nth; i++) {
    idx = hay.indexOf(needle, idx + 1);
    if (idx < 0) throw new Error(`Phrase "${phrase}" (#${nth}) not found in scene ${scene.key}`);
  }
  return idx;
}

/** Seconds (from the start of the narration) at which `phrase` begins being spoken. */
export function phraseStart(scene: SceneTiming, phrase: string, nth = 0): number {
  return scene.starts[findPhrase(scene, phrase, nth)];
}

/** Seconds (from the start of the narration) at which `phrase` has been fully spoken. */
export function phraseEnd(scene: SceneTiming, phrase: string, nth = 0): number {
  return scene.ends[findPhrase(scene, phrase, nth) + phrase.length - 1];
}

export type Gap = { start: number; end: number };

/** Silences in the narration (seconds from the start of the narration), including the lead-in and tail. */
export function speechGaps(scene: SceneTiming, minGap = 0.2, mergeBelow = 0.14): Gap[] {
  const merged: [number, number][] = [];
  scene.characters.forEach((c, i) => {
    if (!/[A-Za-z0-9]/.test(c)) return;
    const last = merged[merged.length - 1];
    if (last && scene.starts[i] - last[1] < mergeBelow) last[1] = Math.max(last[1], scene.ends[i]);
    else merged.push([scene.starts[i], scene.ends[i]]);
  });
  const gaps: Gap[] = [{ start: -LEAD_SECONDS, end: merged[0][0] }];
  for (let i = 1; i < merged.length; i++) gaps.push({ start: merged[i - 1][1], end: merged[i][0] });
  gaps.push({ start: merged[merged.length - 1][1], end: scene.duration + TAIL_SECONDS });
  return gaps.filter((g) => g.end - g.start >= minGap);
}

/**
 * Fits a sound effect wanted at narration-time `t` into a silence, so it never plays over the voice.
 * Uses the gap that ends just before `t` (so it lands as the visual appears) or the first one shortly after.
 * Trims the effect to the gap when it is longer. Returns null when no silence is close enough.
 */
export function placeSfx(scene: SceneTiming, t: number, length: number, maxBefore = 0.35, maxAfter = 1.0): { start: number; length: number } | null {
  let best: { start: number; length: number; score: number } | null = null;
  for (const g of speechGaps(scene)) {
    const room = g.end - g.start - 0.06;
    if (room < 0.15) continue;
    const len = Math.min(length, room);
    let start: number;
    let score: number;
    if (g.end <= t + 0.1) {
      if (t - g.end > maxBefore) continue;
      start = Math.max(g.start + 0.03, g.end - 0.03 - len);
      score = Math.abs(t - g.end);
    } else {
      if (g.start - t > maxAfter) continue;
      start = g.start + 0.03;
      score = Math.abs(g.start - t) + 0.05;
    }
    if (!best || score < best.score) best = { start, length: len, score };
  }
  return best && { start: best.start, length: best.length };
}
