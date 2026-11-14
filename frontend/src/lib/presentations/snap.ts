/**
 * Snapping an element to the page editor's stage as it is dragged or resized:
 * its edges and centre to the stage's and to the other elements'. Pure, so it
 * is tested without a browser.
 */

import { STAGE, type PageElement } from "./page";

/** How near, in stage pixels, an edge or centre must come to another to snap to it. */
export const SNAP = 12;

export type Box = Pick<PageElement, "x" | "y" | "w" | "h">;

/** What a gesture may move on one axis: the whole box, only its start edge, only its end edge, or nothing. */
export type SnapEdge = "move" | "start" | "end" | null;

/**
 * `box` moved so its nearest edge or centre on each axis lands on a line of the
 * stage or of `others`, when one is within SNAP; with the lines it landed on.
 * `edges` says which of the box's edges may move: all of them for a drag, only
 * the ones a handle pulls for a resize.
 */
export function snapBox(box: Box, others: Box[], edges: { x: SnapEdge; y: SnapEdge }): { box: Box; guides: { x: number[]; y: number[] } } {
  const lines = (axis: "x" | "y") => {
    const size = axis === "x" ? STAGE.width : STAGE.height;
    return [
      0,
      size / 2,
      size,
      ...others.flatMap((o) => (axis === "x" ? [o.x, o.x + o.w / 2, o.x + o.w] : [o.y, o.y + o.h / 2, o.y + o.h])),
    ];
  };
  const out = { ...box };
  const guides: { x: number[]; y: number[] } = { x: [], y: [] };
  for (const axis of ["x", "y"] as const) {
    const mode = edges[axis];
    if (!mode) continue;
    const pos = axis === "x" ? "x" : "y";
    const len = axis === "x" ? "w" : "h";
    const start = out[pos];
    const length = out[len];
    const points = mode === "move" ? [start, start + length / 2, start + length] : mode === "start" ? [start] : [start + length];
    let best: { delta: number; line: number } | null = null;
    for (const line of lines(axis)) {
      for (const point of points) {
        const delta = line - point;
        if (Math.abs(delta) <= SNAP && (!best || Math.abs(delta) < Math.abs(best.delta))) best = { delta, line };
      }
    }
    if (!best) continue;
    guides[axis].push(best.line);
    if (mode === "move") out[pos] += best.delta;
    else if (mode === "start") {
      out[pos] += best.delta;
      out[len] -= best.delta;
    } else out[len] += best.delta;
  }
  return { box: out, guides };
}
