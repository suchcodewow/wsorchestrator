/**
 * What the full-screen player and the speaker-notes tab share in the browser:
 * the order a presentation is shown in (the deck's slides with the
 * presentation's own pages among them), where each slide's picture is served,
 * and the BroadcastChannel that keeps the two tabs together. Either one moving
 * says where it is now, a page's reveals included; one that opens asks where
 * the other is.
 */

import type { PageDocument, RevealState } from "./page";
import type { PresentationPage, PresentationSlide } from "./presentations";

export type LiveSlide = Pick<PresentationSlide, "id" | "number" | "googlePageId" | "skipped" | "notes" | "version" | "cached">;

export type LivePage = Pick<PresentationPage, "id" | "before" | "position" | "notes"> &
  Partial<Pick<PresentationPage, "replaces" | "stale">> & { document: PageDocument };

/** One thing shown in turn: a slide of the deck, or one of the presentation's own pages. */
export type ShowItem =
  { kind: "slide"; id: string; slide: LiveSlide; notes: string } | { kind: "page"; id: string; page: LivePage; notes: string };

export type LiveMessage = { type: "hello" } | ({ type: "at"; itemId: string; black: boolean } & RevealState);

/** The slides shown, in order: every one not skipped in Google. */
export const presentedSlides = <T extends Pick<LiveSlide, "skipped">>(slides: T[]): T[] => slides.filter((s) => !s.skipped);

/**
 * What is shown, in order: each page just before the slide it was put before
 * (in the order the pages were added there), then the slide unless it is
 * skipped, or a page converted from it stands in for it (that page is put
 * before it, after any others there, so it takes the slide's place). A page put
 * before a slide since removed from the deck goes last. `keepSkipped` lists
 * skipped slides too, in their place, as the deck's page does; they are never
 * presented.
 */
export function showItems(slides: LiveSlide[], pages: LivePage[], keepSkipped = false): ShowItem[] {
  const known = new Set(slides.map((s) => s.googlePageId));
  const replaced = new Set(pages.flatMap((p) => (p.replaces ? [p.replaces] : [])));
  const before = new Map<string, LivePage[]>();
  const end: LivePage[] = [];
  for (const page of [...pages].sort((a, b) => a.position - b.position)) {
    if (page.before && known.has(page.before)) before.set(page.before, [...(before.get(page.before) ?? []), page]);
    else end.push(page);
  }
  const asItem = (page: LivePage): ShowItem => ({ kind: "page", id: page.id, page, notes: page.notes });
  return [
    ...slides.flatMap((slide): ShowItem[] => [
      ...(before.get(slide.googlePageId) ?? []).map(asItem),
      ...((slide.skipped && !keepSkipped) || replaced.has(slide.googlePageId)
        ? []
        : [{ kind: "slide" as const, id: slide.id, slide, notes: slide.notes }]),
    ]),
    ...end.map(asItem),
  ];
}

export const slideImageUrl = (presentationId: string, slide: Pick<LiveSlide, "id" | "version">) =>
  `/api/presentations/${presentationId}/slides/${slide.id}/image?v=${slide.version}`;

/** The channel the tabs showing `presentationId` talk over; null where the browser has none. */
export function liveChannel(presentationId: string): BroadcastChannel | null {
  return typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(`presentation:${presentationId}`);
}

/** What a key press does, the same in the player and the notes tab: the keys a presentation clicker sends included. */
export function keyAction(e: KeyboardEvent): "next" | "previous" | "first" | "last" | "black" | null {
  if (e.metaKey || e.ctrlKey || e.altKey) return null;
  switch (e.key) {
    case "ArrowRight":
    case "ArrowDown":
    case "PageDown":
    case " ":
    case "Enter":
    case "n":
      return "next";
    case "ArrowLeft":
    case "ArrowUp":
    case "PageUp":
    case "Backspace":
    case "p":
      return "previous";
    case "Home":
      return "first";
    case "End":
      return "last";
    case "b":
    case ".":
      return "black";
    default:
      return null;
  }
}
