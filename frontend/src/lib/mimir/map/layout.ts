/**
 * Where everything sits on the map's canvas: the slides in the first column,
 * headed "EMD", then a column per level, Level 100 next to them and Level 300
 * last, each with its level's name and its groups above the cards. A curve
 * runs from each slide across to each concept it relies on, and from each
 * concept back to the lower-level concepts it requires. Pure, so the geometry
 * is tested rather than eyeballed.
 *
 * Every level that has concepts keeps its column whatever is shown, so a
 * click that hides concepts never moves or resizes anything. Given a section
 * of the slides, only its slides are laid out, and only the concepts they rely
 * on: the study numbers and each slide's tag are the whole course's, so nothing
 * changes meaning when the rest is hidden.
 */

import { conceptsInOrder, slideLevels, type InOrder, type MapLevel, type PublicMap } from "./schema";

export const PAD = 20;
export const SLIDE_W = 78;
export const SLIDE_H = 61;
export const SLIDE_Y = 34;
export const CONCEPT_W = 84;
export const CONCEPT_H = 83;
export const LEVEL_H = 28;
export const GROUP_H = 24;
/** A section's header over its slides, four times a group bar, with room for its course link. */
export const BAND_H = GROUP_H * 4;
const BOTTOM_PAD = 24;

export type PublicConcept = PublicMap["concepts"][number];
export type PlacedConcept = InOrder<PublicConcept> & { x: number; y: number };
export type PlacedGroup = { index: number; id: string; level: MapLevel; name: string; sub?: string; x0: number; x1: number; y: number; concepts: string[] };
export type PlacedLevel = { level: MapLevel; x0: number; x1: number; y: number };
export type Edge = { slide: number; concept: string; level: MapLevel; d: string };
/** From a concept down to one it requires; `level` is the required concept's. */
export type Link = { from: string; to: string; level: MapLevel; d: string };
/** A section's band across the slides it covers, among those shown. */
export type Band = { name: string; band: number; from: number; to: number; count: number; left: number; width: number; top: number; height: number };

export type MapLayout = {
  width: number;
  height: number;
  concepts: PlacedConcept[];
  groups: PlacedGroup[];
  levels: PlacedLevel[];
  /** The slides shown, in order. */
  slides: number[];
  bands: Band[];
  /** The highest level each slide needs across the whole course; a slide no concept uses is absent. */
  need: Record<number, MapLevel>;
  edges: Edge[];
  links: Link[];
  /** The slide's centre across, and its top down. */
  slideX: (n: number) => number;
  slideY: (n: number) => number;
  /** The gap from one slide's start to the next's, along the line the slides run on. */
  slideSpacing: number;
  /** The width every concept card is drawn at, and every slide card. */
  conceptW: number;
  slideW: number;
  /** The heading over a single stack of slides (columns only), placed like a level's. */
  heading: { label: string; left: number; width: number; top: number } | null;
};

/** The gap between level columns, and between the last column and the slides, for the lines to fan out in. */
const COL_GAP = 130;
const SLIDE_COL_GAP = 170;
/** The most a card grows when there is room, so a very wide window gets wider gaps instead of absurd cards. */
const CONCEPT_GROW_MAX = 240;
const SLIDE_GROW_MAX = 300;
/** A share of any spare room goes to the cards, the rest to the gaps between the columns. */
const CARD_SHARE = 0.65;
/** What heads the slides' column. */
export const SLIDES_HEADING = "EMD";
const SLIDE_PITCH = SLIDE_H + 6;

/** `only` is the name of a section of slides to show on its own, or null for the whole deck. */
/** `minWidth` is the room the canvas is shown in: a map narrower than it spreads out to fill it, and one wider than it scrolls. */
/** `slide` is one slide to narrow the concepts to: only those it needs are laid out, while every slide of the section stays. */
export function layoutMap(map: PublicMap, only: string | null = null, minWidth = 0, slide: number | null = null): MapLayout {
  const everyConcept = conceptsInOrder(map);
  const need = slideLevels(everyConcept);
  const section = only === null ? null : map.sections.find((s) => s.name === only);
  const inSection = (n: number) => only === null || (!!section && n >= section.from && n <= section.to);
  const shown = new Set(everyConcept.filter((c) => c.slides.some(inSection) && (slide === null || c.slides.includes(slide))).map((c) => c.id));
  const byId = new Map(everyConcept.map((c) => [c.id, c]));

  // A level keeps its column even when nothing in it is shown.
  const colLevels = ([1, 2, 3] as const).filter((lv) => map.buckets.some((b) => b.level === lv && b.concepts.length > 0));
  const slides = map.slides.map((s) => s.n).filter(inSection);
  // The slides, a section at a time, then any that are in none.
  const stack: { section: PublicMap["sections"][number] | null; slides: number[] }[] = map.sections
    .map((sec) => ({ section: sec, slides: slides.filter((x) => x >= sec.from && x <= sec.to) }))
    .filter((c) => c.slides.length > 0);
  const strays = slides.filter((x) => !map.sections.some((sec) => x >= sec.from && x <= sec.to));
  if (strays.length) stack.push({ section: null, slides: strays });

  const n = colLevels.length;
  const m = map.slides.length ? 1 : 0;
  const natural = 2 * PAD + n * CONCEPT_W + Math.max(0, n - 1) * COL_GAP + (n && m ? SLIDE_COL_GAP : 0) + m * SLIDE_W;
  const extra = Math.max(0, minWidth - natural);
  // Slide cards are given a little more of it than concept cards, being the busier.
  const unit = (extra * CARD_SHARE) / Math.max(n + 1.2 * m, 1);
  const cw = CONCEPT_W + Math.min(unit, CONCEPT_GROW_MAX);
  const sw = SLIDE_W + Math.min(unit * 1.2, SLIDE_GROW_MAX);
  const leftover = Math.max(0, extra - (cw - CONCEPT_W) * n - (sw - SLIDE_W) * m);
  const gapExtra = n ? leftover / n : 0;
  const colGap = COL_GAP + gapExtra;
  const slidesLeft = PAD;
  const colsLeft = m ? slidesLeft + sw + SLIDE_COL_GAP + gapExtra : PAD;

  const placed: PlacedConcept[] = [];
  const groups: PlacedGroup[] = [];
  const levels: PlacedLevel[] = [];
  const top0 = PAD + LEVEL_H + 6;
  let tallest = top0;
  colLevels.forEach((lv, col) => {
    const x0 = colsLeft + col * (cw + colGap);
    let y = top0;
    let first = true;
    map.buckets.forEach((b, i) => {
      if (b.level !== lv) return;
      const ids = b.concepts.filter((id) => shown.has(id));
      if (ids.length === 0) return;
      if (!first) y += 16;
      first = false;
      groups.push({ index: i, id: b.id, level: lv, name: b.name, sub: b.sub, x0, x1: x0 + cw, y, concepts: ids });
      y += GROUP_H + 6;
      ids.forEach((id, k) => {
        placed.push({ ...byId.get(id)!, x: x0 + cw / 2, y });
        y += CONCEPT_H + (k < ids.length - 1 ? 6 : 0);
      });
    });
    levels.push({ level: lv, x0, x1: x0 + cw, y: PAD });
    tallest = Math.max(tallest, y);
  });

  const where = new Map<number, { x: number; y: number }>();
  const bands: Band[] = [];
  let sy = top0;
  stack.forEach((group, k) => {
    if (k > 0) sy += 16;
    if (group.section) {
      bands.push({ name: group.section.name, band: group.section.band, from: group.slides[0]!, to: group.slides.at(-1)!, count: group.slides.length, left: slidesLeft, width: sw, top: sy, height: BAND_H });
      sy += BAND_H + 6;
    }
    group.slides.forEach((s, i) => {
      where.set(s, { x: slidesLeft + sw / 2, y: sy });
      sy += SLIDE_H + (i < group.slides.length - 1 ? 6 : 0);
    });
  });
  tallest = Math.max(tallest, sy);
  const width = Math.max(n ? colsLeft + n * (cw + colGap) - colGap + PAD : slidesLeft + sw + PAD, Math.floor(minWidth));
  const height = tallest + BOTTOM_PAD;
  const heading = m ? { label: SLIDES_HEADING, left: slidesLeft, width: sw, top: PAD } : null;
  const slideX = (s: number) => where.get(s)?.x ?? slidesLeft;
  const slideY = (s: number) => where.get(s)?.y ?? top0;

  const spread = (count: number, i: number, half: number) => (count === 1 ? 0 : -half + (i * 2 * half) / (count - 1));
  const side = CONCEPT_H / 2 - 9;
  const curve = (xa: number, ya: number, xb: number, yb: number) => {
    const mid = (xa - xb) * 0.5;
    return `M${xa.toFixed(1)},${ya.toFixed(1)} C${(xa - mid).toFixed(1)},${ya.toFixed(1)} ${(xb + mid).toFixed(1)},${yb.toFixed(1)} ${xb.toFixed(1)},${yb.toFixed(1)}`;
  };

  const linking: Record<number, PlacedConcept[]> = {};
  for (const c of placed) for (const s of c.slides.filter(inSection)) (linking[s] ??= []).push(c);
  const slideOffset = new Map<string, number>();
  for (const [s, list] of Object.entries(linking)) {
    const sorted = [...list].sort((a, b) => a.y - b.y);
    sorted.forEach((c, i) => slideOffset.set(`${s}|${c.id}`, spread(sorted.length, i, SLIDE_H / 2 - 9)));
  }
  const edges: Edge[] = [];
  for (const c of placed) {
    const sorted = c.slides.filter(inSection).sort((a, b) => a - b);
    sorted.forEach((s, i) => {
      const ya = slideY(s) + SLIDE_H / 2 + (slideOffset.get(`${s}|${c.id}`) ?? 0);
      const yb = c.y + CONCEPT_H / 2 + spread(sorted.length, i, side);
      edges.push({ slide: s, concept: c.id, level: c.level, d: curve(slideX(s) + sw / 2, ya, c.x - cw / 2, yb) });
    });
  }

  // A concept's requirements leave from its left side and arrive at the right side of the concept required.
  const at = new Map(placed.map((c) => [c.id, c]));
  const out = new Map<string, string[]>();
  const into = new Map<string, string[]>();
  for (const c of placed)
    for (const r of c.requires ?? []) {
      if (!at.has(r)) continue;
      (out.get(c.id) ?? out.set(c.id, []).get(c.id)!).push(r);
      (into.get(r) ?? into.set(r, []).get(r)!).push(c.id);
    }
  const links: Link[] = [];
  for (const c of placed) {
    const targets = [...(out.get(c.id) ?? [])].sort((a, b) => at.get(a)!.y - at.get(b)!.y);
    targets.forEach((r, i) => {
      const to = at.get(r)!;
      const arrivals = [...(into.get(r) ?? [])].sort((a, b) => at.get(a)!.y - at.get(b)!.y);
      const ya = c.y + CONCEPT_H / 2 + spread(targets.length, i, side);
      const yb = to.y + CONCEPT_H / 2 + spread(arrivals.length, arrivals.indexOf(c.id), side);
      links.push({ from: c.id, to: r, level: to.level, d: curve(c.x - cw / 2, ya, to.x + cw / 2, yb) });
    });
  }

  return { width, height, conceptW: cw, slideW: sw, heading, concepts: placed, groups, levels, slides, bands, need, edges, links, slideX, slideY, slideSpacing: SLIDE_PITCH };
}
