"use client";

/**
 * The page's stage, to arrange on: the page drawn as it shows, with hidden
 * elements faint, under a layer that picks an element up. Dragging one moves
 * it and its handles resize it, both snapping to the stage's edges and centre
 * and to the other elements', with a guide line where it snapped.
 */

import { useRef, useState } from "react";
import { cq, PageView, placement } from "@/components/presentations/page-view";
import { STAGE, type PageDocument, type PageElement } from "@/lib/presentations/page";
import { snapBox, type Box } from "@/lib/presentations/snap";
import { cn } from "@/lib/utils";

const MIN_SIZE = 20;

type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

/** Where each handle sits on the selected element's box, as fractions of its width and height, and the cursor it shows. */
const HANDLE_AT: Record<Handle, { x: number; y: number; cursor: string }> = {
  nw: { x: 0, y: 0, cursor: "nwse-resize" },
  n: { x: 0.5, y: 0, cursor: "ns-resize" },
  ne: { x: 1, y: 0, cursor: "nesw-resize" },
  e: { x: 1, y: 0.5, cursor: "ew-resize" },
  se: { x: 1, y: 1, cursor: "nwse-resize" },
  s: { x: 0.5, y: 1, cursor: "ns-resize" },
  sw: { x: 0, y: 1, cursor: "nesw-resize" },
  w: { x: 0, y: 0.5, cursor: "ew-resize" },
};

type Gesture = { id: string; handle: Handle | null; startX: number; startY: number; from: Box; scale: number };

export function StageEditor({
  document: doc,
  selectedId,
  onSelect,
  onChange,
}: {
  document: PageDocument;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** An element's new box while it is dragged; `gesture` names the drag so its steps undo as one. */
  onChange: (id: string, box: Box, gesture: string) => void;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const gesture = useRef<(Gesture & { key: string }) | null>(null);
  const [guides, setGuides] = useState<{ x: number[]; y: number[] }>({ x: [], y: [] });

  function begin(e: React.PointerEvent, el: PageElement, handle: Handle | null) {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    onSelect(el.id);
    const rect = stage.current!.getBoundingClientRect();
    gesture.current = {
      id: el.id,
      handle,
      startX: e.clientX,
      startY: e.clientY,
      from: { x: el.x, y: el.y, w: el.w, h: el.h },
      scale: rect.width / STAGE.width,
      key: `${handle ?? "move"}:${el.id}:${e.timeStamp}`,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function drag(e: React.PointerEvent) {
    const g = gesture.current;
    if (!g) return;
    const dx = (e.clientX - g.startX) / g.scale;
    const dy = (e.clientY - g.startY) / g.scale;
    const others = doc.elements.filter((o) => o.id !== g.id);
    let box: Box;
    let edges: Parameters<typeof snapBox>[2];
    if (!g.handle) {
      box = { ...g.from, x: g.from.x + dx, y: g.from.y + dy };
      edges = { x: "move", y: "move" };
    } else {
      box = { ...g.from };
      edges = { x: null, y: null };
      if (g.handle.includes("e")) {
        box.w = Math.max(MIN_SIZE, g.from.w + dx);
        edges.x = "end";
      }
      if (g.handle.includes("w")) {
        const w = Math.max(MIN_SIZE, g.from.w - dx);
        box.x = g.from.x + g.from.w - w;
        box.w = w;
        edges.x = "start";
      }
      if (g.handle.includes("s")) {
        box.h = Math.max(MIN_SIZE, g.from.h + dy);
        edges.y = "end";
      }
      if (g.handle.includes("n")) {
        const h = Math.max(MIN_SIZE, g.from.h - dy);
        box.y = g.from.y + g.from.h - h;
        box.h = h;
        edges.y = "start";
      }
    }
    const snapped = e.altKey ? { box, guides: { x: [], y: [] } } : snapBox(box, others, edges);
    const round = (b: Box): Box => ({
      x: Math.round(b.x),
      y: Math.round(b.y),
      w: Math.max(MIN_SIZE, Math.round(b.w)),
      h: Math.max(MIN_SIZE, Math.round(b.h)),
    });
    setGuides(snapped.guides);
    onChange(g.id, round(snapped.box), g.key);
  }

  function end() {
    gesture.current = null;
    setGuides({ x: [], y: [] });
  }

  const selected = doc.elements.find((el) => el.id === selectedId);

  return (
    <div ref={stage} className="overflow-hidden rounded-lg border shadow-sm" onPointerDown={() => onSelect(null)}>
      <PageView document={doc} state={{ step: 0, clicked: [] }} ghostHidden>
        <div className="absolute inset-0" onPointerMove={drag} onPointerUp={end} onPointerCancel={end}>
          {doc.elements.map((el) => (
            <div
              key={el.id}
              style={placement(el)}
              className={cn("cursor-move", el.id !== selectedId && "hover:outline hover:outline-1 hover:outline-brand/50")}
              onPointerDown={(e) => begin(e, el, null)}
              onPointerMove={drag}
              onPointerUp={end}
              aria-label={`Select ${el.text || el.kind}`}
            />
          ))}
          {selected && (
            <div style={placement(selected)} className="pointer-events-none outline-2 outline-brand">
              {HANDLES.map((handle) => (
                <span
                  key={handle}
                  className="pointer-events-auto absolute size-2.5 -translate-1/2 rounded-xs border border-brand bg-white"
                  style={{ left: `${HANDLE_AT[handle].x * 100}%`, top: `${HANDLE_AT[handle].y * 100}%`, cursor: HANDLE_AT[handle].cursor }}
                  onPointerDown={(e) => begin(e, selected, handle)}
                  onPointerMove={drag}
                  onPointerUp={end}
                />
              ))}
            </div>
          )}
          {guides.x.map((x) => (
            <div
              key={`x${x}`}
              className="pointer-events-none absolute inset-y-0 bg-pink-500"
              style={{ left: `${(x / STAGE.width) * 100}%`, width: cq(2) }}
            />
          ))}
          {guides.y.map((y) => (
            <div
              key={`y${y}`}
              className="pointer-events-none absolute inset-x-0 bg-pink-500"
              style={{ top: `${(y / STAGE.height) * 100}%`, height: cq(2) }}
            />
          ))}
        </div>
      </PageView>
    </div>
  );
}
