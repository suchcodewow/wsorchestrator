/**
 * The Code Lab's running analogy: each step of a code change as the everyday
 * thing it is like, working on a copy of a Google Slides deck. The team's deck
 * is muted and yours brand, the way the history graph draws main and a branch.
 * Sits beside a box's explanation behind a divider, or under it on a
 * narrow screen.
 */

import { cn } from "@/lib/utils";
import {
  Eye,
  Folder,
  History,
  MessageCircleQuestion,
  Pencil,
  Presentation,
  SpellCheck,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";

const DECK_W = 44;
const DECK_H = 56;
const DECK_Y = 4;
const FOLD = 12;
const LEFT_X = 30;
const RIGHT_X = 126;
const ARROW_Y = DECK_Y + DECK_H / 2;
const LABEL_Y = DECK_Y + DECK_H + 14;

function Label({ x, mine, className, children }: { x: number; mine?: boolean; className?: string; children: string }) {
  return (
    <text
      x={x + DECK_W / 2}
      y={LABEL_Y}
      textAnchor="middle"
      className={cn("font-mono text-[10px]", mine ? "fill-brand" : "fill-muted-foreground", className)}
    >
      {children}
    </text>
  );
}

/** A deck. `mine` is your copy; `changed` shows your new slide on it. */
function Deck({ x, mine = false, changed = false }: { x: number; mine?: boolean; changed?: boolean }) {
  return (
    <>
      <path
        d={`M${x + 4},${DECK_Y} H${x + DECK_W - FOLD} L${x + DECK_W},${DECK_Y + FOLD} V${DECK_Y + DECK_H - 4} a4,4 0 0 1 -4,4 H${x + 4} a4,4 0 0 1 -4,-4 V${DECK_Y + 4} a4,4 0 0 1 4,-4 z`}
        className="fill-amber-400"
      />
      <path d={`M${x + DECK_W - FOLD},${DECK_Y} v${FOLD} h${FOLD} z`} className="fill-amber-600" />
      <rect
        x={x + 9}
        y={DECK_Y + 24}
        width={DECK_W - 18}
        height={18}
        rx={1.5}
        className={changed ? "fill-brand" : "fill-white"}
      />
      <Label x={x} mine={mine}>
        {mine ? "your copy" : "team deck"}
      </Label>
    </>
  );
}

/** Something a deck goes to, drawn in the deck's place on the right. */
function Place({ Icon, label, className }: { Icon: LucideIcon; label: string; className: string }) {
  return (
    <>
      <Icon
        x={RIGHT_X}
        y={DECK_Y + (DECK_H - DECK_W) / 2}
        width={DECK_W}
        height={DECK_W}
        strokeWidth={1.5}
        className={className}
      />
      <Label x={RIGHT_X} mine>
        {label}
      </Label>
    </>
  );
}

function Arrow({ dashed = false }: { dashed?: boolean }) {
  return (
    <>
      <line
        x1={LEFT_X + DECK_W + 8}
        y1={ARROW_Y}
        x2={RIGHT_X - 14}
        y2={ARROW_Y}
        className="stroke-brand"
        strokeWidth={2}
        strokeDasharray={dashed ? "4 3" : undefined}
      />
      <path d={`M${RIGHT_X - 7},${ARROW_Y} l-7,-4.5 v9 z`} className="fill-brand" />
    </>
  );
}

const ANALOGIES = {
  branch: {
    alt: "A Google Slides deck with an arrow to your own copy of it",
    caption: "It’s like copying the team's Google Slides deck to work on your own copy.",
    art: (
      <>
        <Deck x={LEFT_X} />
        <Arrow dashed />
        <Deck x={RIGHT_X} mine />
      </>
    ),
  },
  edit: {
    alt: "The team deck unchanged, beside your copy being edited",
    caption: "It’s like editing the slides in your copy, while the team deck stays just as it was.",
    art: (
      <>
        <Deck x={LEFT_X} />
        <Deck x={RIGHT_X} mine changed />
        <circle cx={RIGHT_X + DECK_W} cy={DECK_Y + DECK_H - 4} r={10} className="fill-brand" />
        <Pencil x={RIGHT_X + DECK_W - 6} y={DECK_Y + DECK_H - 10} width={12} height={12} className="text-brand-foreground" />
      </>
    ),
  },
  commit: {
    alt: "Your copy with an arrow to a named version in its history",
    caption: "It's similar to how Google Slides saves each version to history.",
    art: (
      <>
        <Deck x={LEFT_X} mine changed />
        <Arrow dashed />
        <Place Icon={History} label="version 1" className="text-brand" />
      </>
    ),
  },
  push: {
    alt: "Your copy with an arrow to the team's shared drive",
    caption: "It’s like moving your deck to the team’s shared drive. It's still your copy.",
    art: (
      <>
        <Deck x={LEFT_X} mine changed />
        <Arrow dashed />
        <Place Icon={Folder} label="shared drive" className="fill-brand/15 text-brand" />
      </>
    ),
  },
  pr: {
    alt: "Your copy with a question on the arrow to the team deck",
    caption: "It’s like asking a teammate to check your copy before your slides go in the team deck.",
    art: (
      <>
        <Deck x={LEFT_X} mine changed />
        <Arrow dashed />
        <MessageCircleQuestion x={LEFT_X + DECK_W + 16} y={2} width={22} height={22} className="text-brand" />
        <Deck x={RIGHT_X} />
      </>
    ),
  },
  checks: {
    alt: "Your copy with an arrow to a spelling check",
    caption: "Similar to an automatic spelling check before the deck's owner reads the slides.",
    art: (
      <>
        <Deck x={LEFT_X} mine changed />
        <Arrow dashed />
        <Place Icon={SpellCheck} label="auto-check" className="text-emerald-600 dark:text-emerald-400" />
      </>
    ),
  },
  review: {
    alt: "The deck owner reading your copy of the deck",
    caption:
      "In the slides example, your job as deck owner is to make sure the slides fit the theme and goals of the slide deck.",
    art: (
      <>
        <Deck x={LEFT_X} mine changed />
        <Eye x={LEFT_X + DECK_W + 15} y={ARROW_Y - 12} width={24} height={24} className="text-orange-600 dark:text-orange-400" />
        <UserRound
          x={RIGHT_X}
          y={DECK_Y + (DECK_H - DECK_W) / 2}
          width={DECK_W}
          height={DECK_W}
          strokeWidth={1.5}
          className="text-orange-600 dark:text-orange-400"
        />
        <Label x={RIGHT_X} className="fill-orange-600 dark:fill-orange-400">
          deck owner
        </Label>
      </>
    ),
  },
  merged: {
    alt: "Your copy with an arrow to the team deck, which now has your slide",
    caption: "It’s like pasting your slides into the team deck, which then goes out to everyone.",
    art: (
      <>
        <Deck x={LEFT_X} mine changed />
        <Arrow />
        <Deck x={RIGHT_X} changed />
      </>
    ),
  },
  live: {
    alt: "The team deck, with your slide, with an arrow to a presentation",
    caption: "It’s like presenting the team deck: everyone in the room now sees your slide.",
    art: (
      <>
        <Deck x={LEFT_X} changed />
        <Arrow />
        <Place Icon={Presentation} label="presenting" className="text-brand" />
      </>
    ),
  },
} satisfies Record<string, { alt: string; caption: string; art: ReactNode }>;

export function SlidesAnalogy({ step, className }: { step: keyof typeof ANALOGIES; className?: string }) {
  const { alt, caption, art } = ANALOGIES[step];
  return (
    <figure
      className={cn(
        "flex shrink-0 flex-col items-center justify-center gap-2 border-brand-border text-center max-lg:border-t max-lg:pt-4 lg:w-64 lg:self-stretch lg:border-l lg:pl-5",
        className,
      )}
    >
      <svg viewBox="0 0 200 76" width={200} height={76} className="max-w-full overflow-visible" role="img" aria-label={alt}>
        {art}
      </svg>
      <figcaption className="text-xs text-muted-foreground">{caption}</figcaption>
    </figure>
  );
}
