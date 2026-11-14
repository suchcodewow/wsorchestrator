/**
 * What the full-screen player and the speaker-notes tab share in the browser:
 * which slides are presented, where each picture is served, and the
 * BroadcastChannel that keeps the two tabs on the same slide. Either one moving
 * says where it is now; one that opens asks where the other is.
 */

import type { PresentationSlide } from "./presentations";

export type LiveSlide = Pick<PresentationSlide, "id" | "number" | "skipped" | "notes" | "version" | "cached">;

export type LiveMessage = { type: "hello" } | { type: "at"; slideId: string; black: boolean };

/** The slides shown, in order: every one not skipped in Google. */
export const presentedSlides = <T extends Pick<LiveSlide, "skipped">>(slides: T[]): T[] => slides.filter((s) => !s.skipped);

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
