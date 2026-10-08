/**
 * Where a popup goes: beside the thing it belongs to, on screen whatever the
 * edges. Every hand-placed popup — a tooltip, a popover, a suggestion list —
 * goes through `anchorFloating` rather than doing its own arithmetic with
 * `getBoundingClientRect` or a list pinned under its trigger. It flips to the other
 * side when there is no room, slides along to stay inside the window (or the
 * scrolling box it sits in), caps its height to the space left, and follows
 * its anchor as the page scrolls or resizes.
 *
 * Radix's Tooltip, DropdownMenu and Dialog already position themselves this
 * way (they are built on the same library), so use those where the trigger is
 * a React element; this is for the rest.
 */

import { autoUpdate, computePosition, flip, offset, shift, size, type Placement } from "@floating-ui/dom";

/** How far a popup keeps from the window's edges, in pixels. */
const EDGE = 12;

export type FloatingOptions = {
  /** Where it goes when there is room. Default below, aligned to the start. */
  placement?: Placement;
  /** The gap between the anchor and the popup, in pixels. Default 8. */
  gap?: number;
  /**
   * `fixed` (the default) for a popup over the page, so no scrolling box
   * clips it. `absolute` for one that must stay inside its parent in the DOM
   * — a list inside a dialog, which the dialog would otherwise count as
   * outside it — positioned against a `relative` ancestor.
   */
  strategy?: "fixed" | "absolute";
  /** As wide as the anchor: a suggestion list under its field. */
  matchWidth?: boolean;
  /** The tallest it may grow, in pixels, before it scrolls; never taller than the room there is. */
  maxHeight?: number;
};

/**
 * Positions `floating` against `anchor` and keeps it there until the returned
 * function is called. It stays hidden until its first position is worked out,
 * so it never flashes in the corner first. Give `floating` the matching
 * `position` (`fixed` or `absolute`) and `top-0 left-0`.
 */
export function anchorFloating(
  anchor: Element,
  floating: HTMLElement,
  { placement = "bottom-start", gap = 8, strategy = "fixed", matchWidth = false, maxHeight }: FloatingOptions = {},
): () => void {
  floating.style.visibility = "hidden";
  const place = () =>
    computePosition(anchor, floating, {
      placement,
      strategy,
      middleware: [
        offset(gap),
        flip({ padding: EDGE }),
        shift({ padding: EDGE }),
        size({
          padding: EDGE,
          apply({ availableHeight, availableWidth, rects, elements }) {
            const room = Math.max(availableHeight, 0);
            elements.floating.style.maxHeight = `${maxHeight === undefined ? room : Math.min(room, maxHeight)}px`;
            if (matchWidth) elements.floating.style.width = `${rects.reference.width}px`;
            else elements.floating.style.maxWidth = `${Math.max(availableWidth, 0)}px`;
          },
        }),
      ],
    }).then(({ x, y }) => {
      floating.style.left = `${x}px`;
      floating.style.top = `${y}px`;
      floating.style.visibility = "";
    });
  return autoUpdate(anchor, floating, () => void place());
}
