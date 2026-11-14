/**
 * The pure half of converting a Google slide into one of the presentation's
 * own pages (`convert.ts` does the Google half): which of the slide's elements
 * become live, the requests that make one copy of the slide per live element
 * in a scratch deck, the order Google's own animations reveal them in (read
 * from the deck's PowerPoint export), and where each element lies in Google's
 * picture of the slide, found by comparing it with the picture without it.
 */

import { PRESENTATION_LIMITS } from "@/db/schema";
import type { RevealEffect } from "./page";

/** As much of a Slides API page element as conversion reads. */
export type ApiElement = {
  objectId: string;
  size?: { width?: { magnitude?: number }; height?: { magnitude?: number } };
  transform?: { scaleX?: number; scaleY?: number };
  elementGroup?: { children?: ApiElement[] };
};

/** Every object id in `el`, its own and those of everything grouped in it. */
export function objectIds(el: ApiElement): string[] {
  return [el.objectId, ...(el.elementGroup?.children ?? []).flatMap(objectIds)];
}

/** An element as big as the slide is its background, and stays in the picture behind the live ones. */
const BACKGROUND_SHARE = 0.85;

function coversSlide(el: ApiElement, page: { width: number; height: number }): boolean {
  const w = (el.size?.width?.magnitude ?? 0) * Math.abs(el.transform?.scaleX ?? 1);
  const h = (el.size?.height?.magnitude ?? 0) * Math.abs(el.transform?.scaleY ?? 1);
  return w * h >= BACKGROUND_SHARE * page.width * page.height;
}

/**
 * The indexes, in the slide's stacking order, of the elements to make live:
 * every one but those as big as the slide, at most
 * PRESENTATION_LIMITS.convertedElements of them; past that, the ones Google
 * animates come first, then the topmost.
 */
export function liftable(elements: ApiElement[], page: { width: number; height: number }, animated: Set<number>): number[] {
  const candidates = elements.map((el, i) => ({ el, i })).filter(({ el }) => !coversSlide(el, page));
  const ranked = [...candidates].sort((a, b) => Number(animated.has(b.i)) - Number(animated.has(a.i)) || b.i - a.i);
  const kept = new Set(ranked.slice(0, PRESENTATION_LIMITS.convertedElements).map(({ i }) => i));
  return candidates.filter(({ i }) => kept.has(i)).map(({ i }) => i);
}

/** The id an element gets in the copy of the slide made for the `k`th live element. */
export const copyId = (objectId: string, k: number) => `${objectId}_c${k}`.slice(0, 50);

/**
 * The batchUpdate requests that, in the scratch deck, make one copy of slide
 * `slideId` per live element holding only that one of the live elements, and
 * strip every live element from the slide itself, which becomes the background.
 */
export function separationRequests(slideId: string, elements: ApiElement[], lifted: number[]): unknown[] {
  const live = lifted.map((i) => elements[i]!);
  const copies = live.map((_, k) => ({
    duplicateObject: {
      objectId: slideId,
      objectIds: Object.fromEntries([
        [slideId, copyId(slideId, k)],
        ...live.flatMap((el) => objectIds(el).map((id) => [id, copyId(id, k)])),
      ]),
    },
  }));
  const strip = live.flatMap((keep, k) =>
    live.filter((el) => el !== keep).map((el) => ({ deleteObject: { objectId: copyId(el.objectId, k) } })),
  );
  const background = live.map((el) => ({ deleteObject: { objectId: el.objectId } }));
  return [...copies, ...strip, ...background];
}

/** What Google's PowerPoint export says a slide's animations do, by the element each reveals (its index in stacking order). */
export type AnimationPlan = Map<number, { step: number; effect: RevealEffect }>;

/** PowerPoint's entrance presets, as the reveals pages have. */
const PRESET_EFFECT: Record<string, RevealEffect> = { "1": "appear", "10": "fade", "2": "rise", "22": "wipe", "23": "zoom", "53": "zoom" };

/**
 * Each top-level shape's PowerPoint id, and the ids of the shapes grouped in
 * it, mapped to its index among the slide's top-level shapes, which is its
 * index in the Slides API's `pageElements`.
 */
export function shapeIndexes(slideXml: string): Map<string, number> {
  const tree = slideXml.indexOf("<p:spTree>");
  if (tree < 0) return new Map();
  // The tree's own group properties come first; its shapes start after them.
  const start = slideXml.indexOf("</p:grpSpPr>", tree);
  const out = new Map<string, number>();
  let depth = 0;
  let index = -1;
  const tag = /<(\/?)p:(sp|grpSp|pic|graphicFrame|cxnSp)\b[^>]*?(\/?)>|<p:cNvPr\b[^>]*\bid="(\d+)"/g;
  tag.lastIndex = start < 0 ? tree : start;
  for (let m = tag.exec(slideXml); m; m = tag.exec(slideXml)) {
    if (m[4]) {
      if (depth > 0) out.set(m[4], index);
      continue;
    }
    const [, closing, , selfClosing] = m;
    if (closing) depth--;
    else {
      if (depth === 0) index++;
      if (!selfClosing) depth++;
    }
    if (depth < 0) break;
  }
  return out;
}

/**
 * The reveals a slide's own animations make: each click starts a step, and
 * an effect "with" or "after" the one before joins its step. Effects that
 * start with the slide, before any click, are left out, so those elements are
 * simply shown; so are exits and emphasis, which pages do not have.
 */
export function animationPlan(slideXml: string): AnimationPlan {
  const indexes = shapeIndexes(slideXml);
  const plan: AnimationPlan = new Map();
  const timing = slideXml.slice(slideXml.indexOf("<p:timing"));
  if (!timing.startsWith("<p:timing")) return plan;
  let step = 0;
  // An effect is a <p:cTn> carrying a preset, then the <p:spTgt> naming its shape; attributes come in any order.
  const node = /<p:cTn\b([^>]*)>|<p:spTgt\b([^>]*)>/g;
  const attr = (attrs: string, name: string) => attrs.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
  let current: { preset: string; className: string } | null = null;
  for (let m = node.exec(timing); m; m = node.exec(timing)) {
    if (m[2] !== undefined) {
      const spid = attr(m[2], "spid");
      const index = spid === undefined ? undefined : indexes.get(spid);
      if (current?.className === "entr" && step > 0 && index !== undefined && !plan.has(index)) {
        plan.set(index, { step, effect: PRESET_EFFECT[current.preset] ?? "fade" });
      }
      current = null;
      continue;
    }
    const preset = attr(m[1]!, "presetID");
    if (preset === undefined) continue;
    if (attr(m[1]!, "nodeType") === "clickEffect") step++;
    current = { preset, className: attr(m[1]!, "presetClass") ?? "" };
  }
  return plan;
}

/** Where two pictures of the same size differ, by a channel moving more than this, out of 255. */
const DIFFERENT = 24;
/** Room left round an element's cut-out, for its anti-aliased edge and any shadow. */
export const CUT_PADDING = 6;

/**
 * The box, in pixels, round everything that differs between two RGB pictures
 * of `width`×`height`, padded and kept inside them; null if they are the same.
 */
export function differenceBox(
  a: Uint8Array,
  b: Uint8Array,
  width: number,
  height: number,
  channels = 3,
): { left: number; top: number; width: number; height: number } | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      if (
        Math.abs(a[i]! - b[i]!) > DIFFERENT ||
        Math.abs(a[i + 1]! - b[i + 1]!) > DIFFERENT ||
        Math.abs(a[i + 2]! - b[i + 2]!) > DIFFERENT
      ) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  const left = Math.max(0, minX - CUT_PADDING);
  const top = Math.max(0, minY - CUT_PADDING);
  return {
    left,
    top,
    width: Math.min(width, maxX + 1 + CUT_PADDING) - left,
    height: Math.min(height, maxY + 1 + CUT_PADDING) - top,
  };
}
