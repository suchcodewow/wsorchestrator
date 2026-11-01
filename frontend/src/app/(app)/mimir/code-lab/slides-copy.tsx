/**
 * A Google Slides deck and a copy of it, the everyday thing a branch is like.
 * The deck is muted and the copy brand, the way the history graph draws main
 * and a branch.
 */

import { cn } from "@/lib/utils";

const DECK_W = 44;
const DECK_H = 56;
const DECK_Y = 4;
const FOLD = 12;
const ORIGINAL_X = 30;
const COPY_X = 126;
const ARROW_Y = DECK_Y + DECK_H / 2;

function Deck({ x, label, labelClass }: { x: number; label: string; labelClass: string }) {
  return (
    <>
      <path
        d={`M${x + 4},${DECK_Y} H${x + DECK_W - FOLD} L${x + DECK_W},${DECK_Y + FOLD} V${DECK_Y + DECK_H - 4} a4,4 0 0 1 -4,4 H${x + 4} a4,4 0 0 1 -4,-4 V${DECK_Y + 4} a4,4 0 0 1 4,-4 z`}
        className="fill-amber-400"
      />
      <path d={`M${x + DECK_W - FOLD},${DECK_Y} v${FOLD} h${FOLD} z`} className="fill-amber-600" />
      <rect x={x + 9} y={DECK_Y + 24} width={DECK_W - 18} height={18} rx={1.5} className="fill-white" />
      <text x={x + DECK_W / 2} y={DECK_Y + DECK_H + 14} textAnchor="middle" className={cn("font-mono text-[10px]", labelClass)}>
        {label}
      </text>
    </>
  );
}

export function SlidesCopy() {
  return (
    <svg viewBox="0 0 200 76" width={200} height={76} className="max-w-full" role="img" aria-label="A Google Slides deck with an arrow to your own copy of it">
      <Deck x={ORIGINAL_X} label="team deck" labelClass="fill-muted-foreground" />
      <line
        x1={ORIGINAL_X + DECK_W + 8}
        y1={ARROW_Y}
        x2={COPY_X - 14}
        y2={ARROW_Y}
        className="stroke-brand"
        strokeWidth={2}
        strokeDasharray="4 3"
      />
      <path d={`M${COPY_X - 7},${ARROW_Y} l-7,-4.5 v9 z`} className="fill-brand" />
      <Deck x={COPY_X} label="your copy" labelClass="fill-brand" />
    </svg>
  );
}
