/**
 * Review the "Our understanding" slide: the shape of the slide a team builds
 * to play a customer's priorities back to them, after the EMD deck's (current
 * state against future state, then the required capabilities), and how its
 * mistakes are described. A slide is written as it should be; every flaw
 * names one element of it and how that element looks while it is wrong.
 * Clicking the element puts it right. Slides are made from a seed by
 * `generate.ts`, out of the phrases in `bank.ts`, so the game never runs out.
 * The slide is seen smaller than in a presentation, so each mistake is made
 * plain enough to spot at that size: five spaces rather than two, a shift of
 * 20 pixels rather than 8, a font far from Geist rather than one close to it.
 */

import type { Capability, Row } from "./bank";

export type { Capability, Row };

export type RowIndex = 0 | 1 | 2 | 3 | 4;
export type Side = "current" | "future";
export type RowPart = "head" | "sub" | "icon";

/** One clickable piece of a slide. Only a flaw's `extra` adds a piece that a finished slide doesn't have. */
export type Target =
  | "title"
  | "subtitle"
  | "logo"
  | `header.${Side}`
  | `headerIcon.${Side}`
  | `${Side}.${RowIndex}.${RowPart}`
  | "capabilitiesTitle"
  | `capability.${number}`
  | "capabilitiesBox"
  | "arrow"
  | "divider"
  | "extra";

export type SlideFont = "geist" | "geist-mono" | "georgia" | "arial" | "times" | "verdana" | "courier" | "comic";

export type FlawKind =
  | "spelling"
  | "grammar"
  | "punctuation"
  | "capitalization"
  | "consistency"
  | "font"
  | "size"
  | "style"
  | "color"
  | "alignment"
  | "spacing"
  | "icon"
  | "layout"
  | "leftover";

export const KIND_LABEL: Record<FlawKind, string> = {
  spelling: "Spelling",
  grammar: "Grammar",
  punctuation: "Punctuation",
  capitalization: "Capitalization",
  consistency: "Consistency",
  font: "Font",
  size: "Font size",
  style: "Bold or italic",
  color: "Color",
  alignment: "Alignment",
  spacing: "Spacing",
  icon: "Icon",
  layout: "Layout",
  leftover: "Left behind",
};

/** How an element differs while it is wrong. Anything left out looks as it should. */
export type Look = {
  /** The element's words, or a capability's lead-in. */
  text?: string;
  /** A capability's measure; empty drops the arrow with it. */
  metric?: string;
  arrow?: string;
  bullet?: string;
  font?: SlideFont;
  /** In pixels of the 1280 × 720 slide. */
  size?: number;
  weight?: number;
  italic?: boolean;
  color?: string;
  dx?: number;
  dy?: number;
  /** An icon, the logo or the arrow drawn bigger or smaller. */
  scale?: number;
  /** The logo pulled wider (over 1) or squashed (under 1). */
  stretch?: number;
  /** The wrong mark: a tick on the current-state side, a cross on the future one. */
  icon?: "check" | "cross";
  highlight?: boolean;
  underline?: boolean;
  /** The capabilities box drawn with a solid edge instead of a dashed one. */
  solid?: boolean;
  /** The arrow pointing from the future back to the current state. */
  pointLeft?: boolean;
};

/** Something left on the slide that shouldn't be there at all. */
export type Extra = { text: string; x: number; y: number; style: "placeholder" | "sticky" };

export type Flaw = { target: Target; kind: FlawKind; note: string; look: Look; extra?: Extra };

export type Slide = {
  /** What the slide was made from: the same seed always makes the same slide. */
  seed: number;
  /** The theme's id and name in `bank.ts`. */
  theme: string;
  themeName: string;
  subtitle: string;
  current: [Row, Row, Row, Row, Row];
  future: [Row, Row, Row, Row, Row];
  capabilities: Capability[];
  flaws: Flaw[];
};

export const TITLE = "Our understanding…";
export const CAPABILITIES_TITLE = "Required capabilities";
export const ARROW = "→";
export const BULLET = "●";

/** Each slide has this many mistakes, inclusive. */
export const FLAWS_PER_SLIDE = { min: 10, max: 15 } as const;

export const POINTS = { found: 1, wrongClick: -1, missed: -2 } as const;

/** Every piece of a finished slide that can be clicked. */
export function targetsOf(slide: Slide): Target[] {
  const rows = (side: Side) =>
    ([0, 1, 2, 3, 4] as const).flatMap((i) => (["head", "sub", "icon"] as const).map((part): Target => `${side}.${i}.${part}`));
  return [
    "title",
    "subtitle",
    "logo",
    "header.current",
    "header.future",
    "headerIcon.current",
    "headerIcon.future",
    ...rows("current"),
    ...rows("future"),
    "capabilitiesTitle",
    ...slide.capabilities.map((_, i): Target => `capability.${i}`),
    "capabilitiesBox",
    "arrow",
    "divider",
  ];
}

export type SlideResult = { found: number; wrongClicks: number; missed: number };

/** The best a slide allows: every mistake found and nothing else clicked. */
export const maxPointsFor = (slide: Slide) => slide.flaws.length * POINTS.found;

export const pointsFor = (r: SlideResult) =>
  r.found * POINTS.found + r.wrongClicks * POINTS.wrongClick + r.missed * POINTS.missed;

export type Verdict = { from: number; title: string; verdict: string };

/** Read top down: the first whose `from` the share of the maximum reaches. */
export const VERDICTS: Verdict[] = [
  { from: 0.9, title: "Ready for the customer", verdict: "Hardly anything got past you. These slides would go out crisp and clean." },
  { from: 0.7, title: "Nearly there", verdict: "You caught most of it. Slow down on the last pass: the small things are what a customer notices." },
  {
    from: 0.4,
    title: "Needs another pass",
    verdict: "Plenty slipped through. Read each line on its own, then look down every column edge.",
  },
  {
    from: -Infinity,
    title: "Not ready to send",
    verdict: "Too many issues got through, or too many good parts were clicked. Review one kind of problem at a time.",
  },
];

/** The verdict on `total` points out of a possible `max`. */
export const verdictFor = (total: number, max: number) => VERDICTS.find((v) => total >= v.from * max)!;
