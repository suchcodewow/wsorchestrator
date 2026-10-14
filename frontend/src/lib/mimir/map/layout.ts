/**
 * Where everything sits on the map's canvas: the slides along the top, the
 * concepts in study order along the bottom, a curve from each slide down to
 * each concept it relies on, and the groups and levels beneath. Pure, so the
 * geometry is tested rather than eyeballed.
 *
 * The concepts are laid out first, in course order and grouped, because their
 * width fixes the canvas; the slides are then spread evenly across it. Given a
 * level, only that level's concepts are laid out, and only the slides that need
 * them, packed together: the study numbers and each slide's tag are the whole
 * course's, so nothing changes meaning when the rest is hidden.
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
/** The least room a slide is given, so a few concepts with many slides never stack them. */
const SLIDE_ROOM = SLIDE_W + 6;

export type PublicConcept = PublicMap["concepts"][number];
export type PlacedConcept = InOrder<PublicConcept> & { x: number };
export type PlacedGroup = { index: number; id: string; level: MapLevel; name: string; sub?: string; x0: number; x1: number; concepts: string[] };
export type PlacedLevel = { level: MapLevel; x0: number; x1: number };
export type Edge = { slide: number; concept: string; level: MapLevel; d: string };
/** A section's band across the slides it covers, among those shown. */
export type Band = { name: string; band: number; from: number; to: number; count: number; left: number; width: number };

export type MapLayout = {
  width: number;
  concepts: PlacedConcept[];
  groups: PlacedGroup[];
  levels: PlacedLevel[];
  /** The slides shown, in order. */
  slides: number[];
  bands: Band[];
  /** The highest level each slide needs across the whole course; a slide no concept uses is absent. */
  need: Record<number, MapLevel>;
  edges: Edge[];
  slideX: (n: number) => number;
  slideSpacing: number;
};

export function layoutMap(map: PublicMap, only: MapLevel | null = null): MapLayout {
  const everyConcept = conceptsInOrder(map);
  const need = slideLevels(everyConcept);
  const shown = new Set(everyConcept.filter((c) => !only || c.level === only).map((c) => c.id));
  const byId = new Map(everyConcept.map((c) => [c.id, c]));

  // Concepts, grouped, left to right.
  const placed: PlacedConcept[] = [];
  const groups: PlacedGroup[] = [];
  let x = PAD;
  let previous: MapLevel | null = null;
  map.buckets.forEach((b, i) => {
    const ids = b.concepts.filter((id) => shown.has(id));
    if (ids.length === 0) return;
    if (previous !== null) x += previous !== b.level ? 30 : 16;
    previous = b.level;
    const x0 = x;
    ids.forEach((id, k) => {
      placed.push({ ...byId.get(id)!, x: x + CONCEPT_W / 2 });
      x += CONCEPT_W + (k < ids.length - 1 ? 6 : 0);
    });
    groups.push({ index: i, id: b.id, level: b.level, name: b.name, sub: b.sub, x0, x1: x, concepts: ids });
  });

  // The slides that need what is shown, or all of them.
  const slides = map.slides.map((s) => s.n).filter((n) => !only || placed.some((c) => c.slides.includes(n)));
  const conceptsWidth = x + PAD;
  const width = Math.max(conceptsWidth, 2 * PAD + slides.length * SLIDE_ROOM);
  // Fewer concepts than the slides need room for: centre them in what the slides need.
  const shift = (width - conceptsWidth) / 2;
  if (shift > 0) {
    for (const c of placed) c.x += shift;
    for (const g of groups) {
      g.x0 += shift;
      g.x1 += shift;
    }
  }

  const levels: PlacedLevel[] = ([1, 2, 3] as const).flatMap((level) => {
    const g = groups.filter((gr) => gr.level === level);
    return g.length ? [{ level, x0: g[0]!.x0, x1: g.at(-1)!.x1 }] : [];
  });

  const slideSpacing = (width - 2 * PAD) / Math.max(slides.length, 1);
  const position = new Map(slides.map((n, i) => [n, i + 1]));
  const slideX = (n: number) => PAD + slideSpacing * ((position.get(n) ?? 1) - 0.5);

  const bands: Band[] = map.sections.flatMap((s) => {
    const inside = slides.filter((n) => n >= s.from && n <= s.to);
    if (inside.length === 0) return [];
    const first = position.get(inside[0]!)!;
    return [{ name: s.name, band: s.band, from: inside[0]!, to: inside.at(-1)!, count: inside.length, left: PAD + slideSpacing * (first - 1) + 1, width: slideSpacing * inside.length - 6 }];
  });

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

  return { width, concepts: placed, groups, levels, slides, bands, need, edges, slideX, slideSpacing };
}
