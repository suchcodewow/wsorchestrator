/**
 * Where everything sits on the map's canvas: the slides along the top, the
 * concepts in study order along the bottom, a curve from each slide down to
 * each concept it relies on, and the groups and levels beneath. Pure, so the
 * geometry is tested rather than eyeballed.
 *
 * The concepts are laid out first, in course order and grouped, because their
 * width fixes the canvas; the slides are then spread evenly across it.
 */

import { conceptsInOrder, slideLevels, type InOrder, type MapLevel, type PublicMap } from "./schema";

export const PAD = 20;
export const SLIDE_W = 78;
export const SLIDE_H = 122;
export const SLIDE_Y = 34;
export const CONCEPT_W = 84;
export const CONCEPT_H = 124;
export const CONCEPT_Y = 516;
export const GROUP_Y = CONCEPT_Y + CONCEPT_H + 6;
export const LEVEL_Y = GROUP_Y + 30;
export const CANVAS_H = LEVEL_Y + 40;

export type PublicConcept = PublicMap["concepts"][number];
export type PlacedConcept = InOrder<PublicConcept> & { x: number };
export type PlacedGroup = { index: number; id: string; level: MapLevel; name: string; sub?: string; x0: number; x1: number; concepts: string[] };
export type PlacedLevel = { level: MapLevel; x0: number; x1: number };
export type Edge = { slide: number; concept: string; level: MapLevel; d: string };

export type MapLayout = {
  width: number;
  concepts: PlacedConcept[];
  groups: PlacedGroup[];
  levels: PlacedLevel[];
  /** The highest level each slide needs; a slide no concept uses is absent. */
  need: Record<number, MapLevel>;
  edges: Edge[];
  slideX: (n: number) => number;
  slideSpacing: number;
};

export function layoutMap(map: PublicMap): MapLayout {
  const concepts = conceptsInOrder(map);
  const byId = new Map(concepts.map((c) => [c.id, c]));

  const placed: PlacedConcept[] = [];
  const groups: PlacedGroup[] = [];
  let x = PAD;
  map.buckets.forEach((b, i) => {
    if (i > 0) x += map.buckets[i - 1]!.level !== b.level ? 30 : 16;
    const x0 = x;
    b.concepts.forEach((id, k) => {
      const c = byId.get(id);
      if (!c) return;
      placed.push({ ...c, x: x + CONCEPT_W / 2 });
      x += CONCEPT_W + (k < b.concepts.length - 1 ? 6 : 0);
    });
    groups.push({ index: i, id: b.id, level: b.level, name: b.name, sub: b.sub, x0, x1: x, concepts: b.concepts });
  });
  const width = x + PAD;

  const levels: PlacedLevel[] = ([1, 2, 3] as const).flatMap((level) => {
    const g = groups.filter((gr) => gr.level === level);
    return g.length ? [{ level, x0: g[0]!.x0, x1: g.at(-1)!.x1 }] : [];
  });

  const slideCount = map.slides.length;
  const slideSpacing = (width - 2 * PAD) / slideCount;
  const slideX = (n: number) => PAD + slideSpacing * (n - 0.5);

  const need = slideLevels(placed);
  const linking: Record<number, PlacedConcept[]> = {};
  for (const c of placed) for (const n of c.slides) (linking[n] ??= []).push(c);

  // Spread the lines that meet at one end of a card so they fan out instead of stacking.
  const spread = (count: number, i: number, half: number) => (count === 1 ? 0 : -half + (i * 2 * half) / (count - 1));
  const slideOffset = new Map<string, number>();
  for (const [n, list] of Object.entries(linking)) {
    const sorted = [...list].sort((a, b) => a.x - b.x);
    sorted.forEach((c, i) => slideOffset.set(`${n}|${c.id}`, spread(sorted.length, i, SLIDE_W / 2 - 9)));
  }
  const edges: Edge[] = [];
  const y1 = SLIDE_Y + SLIDE_H;
  const y2 = CONCEPT_Y;
  const dy = (y2 - y1) * 0.5;
  for (const c of placed) {
    const sorted = [...c.slides].sort((a, b) => a - b);
    sorted.forEach((n, i) => {
      const xa = slideX(n) + (slideOffset.get(`${n}|${c.id}`) ?? 0);
      const xb = c.x + spread(sorted.length, i, CONCEPT_W / 2 - 9);
      const d = `M${xa.toFixed(1)},${y1} C${xa.toFixed(1)},${y1 + dy} ${xb.toFixed(1)},${y2 - dy} ${xb.toFixed(1)},${y2}`;
      edges.push({ slide: n, concept: c.id, level: c.level, d });
    });
  }

  return { width, concepts: placed, groups, levels, need, edges, slideX, slideSpacing };
}
