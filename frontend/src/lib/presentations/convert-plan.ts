/**
 * The pure half of converting a Google slide into one of the presentation's
 * own pages (`convert.ts` does the Google half): which of the slide's elements
 * become live, the requests that, in a scratch deck, strip them from the slide
 * and give each a copy of the slide holding it alone on black and on white,
 * the order Google's own animations reveal them in (read from the deck's
 * PowerPoint export), and each element's own pixels, opacity and all, worked
 * out from Google's two pictures of it alone.
 */

import { PRESENTATION_LIMITS } from "@/db/schema";
import { MAX_ENTRY_DELAY_MS, type RevealEffect } from "./page";

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

/** The backdrop a live element is drawn alone on, to tell its own pixels from what lies behind them. */
export type Backdrop = "black" | "white";

/** The id an element gets in the copy of the slide that shows the `k`th live element alone on `backdrop`. */
export const copyId = (objectId: string, k: number, backdrop: Backdrop) => `${objectId}_${backdrop[0]}${k}`.slice(0, 50);

const SOLID: Record<Backdrop, { red: number; green: number; blue: number }> = {
  black: { red: 0, green: 0, blue: 0 },
  white: { red: 1, green: 1, blue: 1 },
};

/**
 * The batchUpdate requests that, in the scratch deck, give each live element
 * two copies of slide `slideId` holding it and nothing else, one on solid
 * black and one on solid white, and strip every live element from the slide
 * itself, which becomes the background.
 */
export function isolationRequests(slideId: string, elements: ApiElement[], lifted: number[]): unknown[] {
  const copies = lifted.flatMap((keep, k) =>
    (["black", "white"] as const).flatMap((backdrop) => {
      const id = (objectId: string) => copyId(objectId, k, backdrop);
      return [
        {
          duplicateObject: {
            objectId: slideId,
            objectIds: Object.fromEntries([[slideId, id(slideId)], ...elements.flatMap((el) => objectIds(el).map((o) => [o, id(o)]))]),
          },
        },
        ...elements.filter((_, i) => i !== keep).map((el) => ({ deleteObject: { objectId: id(el.objectId) } })),
        {
          updatePageProperties: {
            objectId: id(slideId),
            pageProperties: { pageBackgroundFill: { solidFill: { color: { rgbColor: SOLID[backdrop] } } } },
            fields: "pageBackgroundFill",
          },
        },
      ];
    }),
  );
  const background = lifted.map((i) => ({ deleteObject: { objectId: elements[i]!.objectId } }));
  return [...copies, ...background];
}

/** As much of a layout or master as conversion reads: what it draws on every slide that uses it. */
export type ApiBackdropPage = { pageElements?: { objectId: string; shape?: { placeholder?: unknown } }[] };

/**
 * Requests deleting what the slide's layout and master draw on it, so a copy
 * shows its one element alone. Placeholders stay: they draw nothing on a
 * slide, and the slide's own text takes its style from them.
 */
export function backdropRequests(pages: ApiBackdropPage[]): unknown[] {
  return pages.flatMap((page) =>
    (page.pageElements ?? []).filter((el) => !el.shape?.placeholder).map((el) => ({ deleteObject: { objectId: el.objectId } })),
  );
}

/** What Google's PowerPoint export says a slide's animations do, by the element each reveals (its index in stacking order). */
/** `step` 0 is an on-entry reveal, `delay` milliseconds after the slide appears; steps from 1 are the clicks. */
export type AnimationPlan = Map<number, { step: number; effect: RevealEffect; delay?: number }>;

/** How long an on-entry effect runs when the export does not say, so the one "after" it knows when to start. */
const ENTRY_EFFECT_MS = 500;

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
 * The reveals a slide's own animations make: each click starts a step, and an
 * effect "with" or "after" the one before joins its step. Effects that play
 * as the slide opens, before any click, are step 0, on-entry reveals: each
 * starts with the one before it ("with") or as it ends ("after"), plus its own
 * delay, and `delay` says when, in milliseconds. Exits and emphasis are left
 * out, since pages do not have them.
 */
export function animationPlan(slideXml: string): AnimationPlan {
  const indexes = shapeIndexes(slideXml);
  const plan: AnimationPlan = new Map();
  const timing = slideXml.slice(slideXml.indexOf("<p:timing"));
  if (!timing.startsWith("<p:timing")) return plan;

  // Each effect whole first: a <p:cTn> with a preset; the first <p:cond> after it is its own delay, the first
  // <p:spTgt> its shape, and the longest <p:cTn dur> inside it how long it runs. Attributes come in any order.
  type Effect = { preset: string; className: string; node: string; delay: number | null; dur: number; spid: string | null };
  const effects: Effect[] = [];
  const tag = /<p:cTn\b([^>]*)>|<p:spTgt\b([^>]*)>|<p:cond\b([^>]*)>/g;
  const attr = (attrs: string, name: string) => attrs.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
  for (let m = tag.exec(timing); m; m = tag.exec(timing)) {
    const current = effects.at(-1);
    if (m[1] !== undefined) {
      const preset = attr(m[1], "presetID");
      if (preset !== undefined) {
        effects.push({
          preset,
          className: attr(m[1], "presetClass") ?? "",
          node: attr(m[1], "nodeType") ?? "",
          delay: null,
          dur: 0,
          spid: null,
        });
      } else if (current) {
        const dur = Number(attr(m[1], "dur"));
        if (Number.isFinite(dur) && dur > 1) current.dur = Math.max(current.dur, dur);
      }
    } else if (m[2] !== undefined) {
      if (current && current.spid === null) current.spid = attr(m[2], "spid") ?? null;
    } else if (current && current.delay === null) {
      const delay = Number(attr(m[3]!, "delay"));
      if (Number.isFinite(delay)) current.delay = delay;
    }
  }

  let step = 0;
  // The on-entry timeline: when the effect before began, and when it ended.
  let began = 0;
  let ended = 0;
  for (const e of effects) {
    if (e.node === "clickEffect") step++;
    let delay: number | undefined;
    if (step === 0) {
      const start = (e.node === "afterEffect" ? ended : began) + (e.delay ?? 0);
      began = start;
      ended = start + (e.dur || ENTRY_EFFECT_MS);
      delay = Math.min(Math.round(start), MAX_ENTRY_DELAY_MS);
    }
    const index = e.spid === null ? undefined : indexes.get(e.spid);
    if (e.className !== "entr" || index === undefined || plan.has(index)) continue;
    plan.set(index, { step, effect: PRESET_EFFECT[e.preset] ?? "fade", ...(delay === undefined ? {} : { delay }) });
  }
  return plan;
}

/** Below this opacity, out of 1, a pixel counts as none of the element's: what is left of a render's own noise. */
const VISIBLE = 0.03;
/** Room left round an element's cut-out, for the faintest edge of its anti-aliasing or shadow. */
export const CUT_PADDING = 2;

export type Box = { left: number; top: number; width: number; height: number };

/**
 * One element's own pixels, from Google's two pictures of it alone: `black`
 * on a black backdrop and `white` on a white one, RGB, `width`×`height`. Where
 * the element is opaque both pictures agree; where it lets the backdrop
 * through they differ by exactly how much, so each pixel's opacity is
 * 1 - (white - black) / 255, and its colour is what the black picture shows,
 * over that opacity. Returns the RGBA pixels and the box round every visible
 * one, padded and kept inside the picture; the box is null if nothing shows.
 */
export function unmatte(black: Uint8Array, white: Uint8Array, width: number, height: number): { rgba: Uint8Array; box: Box | null } {
  const rgba = new Uint8Array(width * height * 4);
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      const i = p * 3;
      const through = (white[i]! - black[i]! + white[i + 1]! - black[i + 1]! + white[i + 2]! - black[i + 2]!) / (3 * 255);
      const alpha = Math.min(1, Math.max(0, 1 - through));
      const o = p * 4;
      if (alpha > 0) {
        rgba[o] = Math.min(255, Math.round(black[i]! / alpha));
        rgba[o + 1] = Math.min(255, Math.round(black[i + 1]! / alpha));
        rgba[o + 2] = Math.min(255, Math.round(black[i + 2]! / alpha));
      }
      rgba[o + 3] = Math.round(alpha * 255);
      if (alpha > VISIBLE) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return { rgba, box: null };
  const left = Math.max(0, minX - CUT_PADDING);
  const top = Math.max(0, minY - CUT_PADDING);
  return {
    rgba,
    box: { left, top, width: Math.min(width, maxX + 1 + CUT_PADDING) - left, height: Math.min(height, maxY + 1 + CUT_PADDING) - top },
  };
}
