"use client";

/**
 * Pointing at the element a tour step is about. While it is open, the
 * element under the pointer is outlined; a click picks it instead of doing
 * whatever it would do, the up arrow widens the pick to its parent and the
 * down arrow narrows it back, and Escape gives up. The page still scrolls, so
 * something further down can be reached. The editor's own panel, and
 * anything else marked `data-tour-ui`, is left alone.
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { autoUpdate } from "@floating-ui/dom";
import { Button } from "@/components/ui/button";
import { nameOf, targetFor, type PickNode } from "@/lib/tours/target";
import type { TourTarget } from "@/lib/tours/target";

/** Marks the tour's own controls, which the picker and the player leave alone. */
export const TOUR_UI = "data-tour-ui";

function ours(node: EventTarget | null): boolean {
  return node instanceof Element && !!node.closest(`[${TOUR_UI}]`);
}

export function TourPicker({ onPick, onCancel }: { onPick: (target: TourTarget) => void; onCancel: () => void }) {
  // The element under the pointer, and the ancestors the up arrow has widened it to.
  const [trail, setTrail] = useState<Element[]>([]);
  const outline = useRef<HTMLDivElement>(null);
  const picked = trail.at(-1) ?? null;
  // What a click picks, read by the window's listener, which outlives any one render.
  const latest = useRef<Element | null>(null);
  useEffect(() => {
    latest.current = picked;
  }, [picked]);

  useEffect(() => {
    const swallow = (e: Event) => {
      if (ours(e.target)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    const move = (e: PointerEvent) => {
      if (ours(e.target) || !(e.target instanceof Element)) return;
      const el = e.target;
      setTrail((t) => (t[0] === el ? t : [el]));
    };
    const click = (e: MouseEvent) => {
      if (ours(e.target)) return;
      swallow(e);
      if (latest.current) onPick(targetFor(latest.current as unknown as PickNode, document));
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setTrail((t) => {
          const parent = t.at(-1)?.parentElement;
          return parent && parent !== document.body ? [...t, parent] : t;
        });
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setTrail((t) => (t.length > 1 ? t.slice(0, -1) : t));
      }
    };
    const pressEvents = ["pointerdown", "mousedown", "pointerup", "mouseup", "dblclick", "auxclick"] as const;
    for (const type of pressEvents) window.addEventListener(type, swallow, true);
    window.addEventListener("pointermove", move, true);
    window.addEventListener("click", click, true);
    window.addEventListener("keydown", key, true);
    document.documentElement.style.cursor = "crosshair";
    return () => {
      for (const type of pressEvents) window.removeEventListener(type, swallow, true);
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("click", click, true);
      window.removeEventListener("keydown", key, true);
      document.documentElement.style.cursor = "";
    };
  }, [onPick, onCancel]);

  // The outline is drawn over the element, following it as the page scrolls.
  useEffect(() => {
    const box = outline.current;
    if (!picked || !box) return;
    return autoUpdate(picked, box, () => {
      const r = picked.getBoundingClientRect();
      box.style.transform = `translate(${r.left}px, ${r.top}px)`;
      box.style.width = `${r.width}px`;
      box.style.height = `${r.height}px`;
    });
  }, [picked]);

  const label = picked ? nameOf(picked as unknown as PickNode) || picked.tagName.toLowerCase() : null;

  return createPortal(
    <>
      {picked && (
        <div
          ref={outline}
          aria-hidden
          className="pointer-events-none fixed top-0 left-0 z-[60] rounded-sm bg-primary/10 outline-2 outline-primary"
        />
      )}
      <div
        {...{ [TOUR_UI]: "" }}
        role="status"
        className="fixed top-3 left-1/2 z-[60] flex max-w-[calc(100vw-24px)] -translate-x-1/2 items-center gap-3 rounded-xl border bg-popover px-4 py-2 text-sm text-popover-foreground shadow-lg dark:border-foreground/20"
      >
        <span className="min-w-0 truncate">
          {label ? (
            <>
              Click to pick <span className="font-medium">{label}</span>
            </>
          ) : (
            "Point at the element this step is about"
          )}
          <span className="text-muted-foreground"> · ↑ parent · ↓ back · Esc cancels</span>
        </span>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </>,
    document.body,
  );
}
