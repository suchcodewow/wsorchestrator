/**
 * A presentation's own page: one that is not in the Google deck but is shown
 * among its slides, drawn on a 1920×1080 stage. It holds a background and a
 * stack of shapes and text boxes, each either always shown or revealed: by the
 * next press of the arrow key or clicker, in order, or by a click on another
 * element, so a slide's hidden answers can be uncovered in any order.
 *
 * Pure, so the editor, the player, the speaker-notes tab and the routes that
 * store a page all read it the same way.
 */

import { z } from "zod";

export const STAGE = { width: 1920, height: 1080 } as const;

export const PAGE_LIMITS = { elements: 120, text: 4_000, notes: 20_000 } as const;

/** `image` is a picture kept with the presentation, such as one element cut from a converted Google slide; it is not drawn from the shape fields. */
export const ELEMENT_KINDS = ["rect", "ellipse", "text", "image"] as const;
export type ElementKind = (typeof ELEMENT_KINDS)[number];

/** The kinds the editor's toolbar adds; pictures come from converting a slide. */
export type DrawnKind = Exclude<ElementKind, "image">;

/**
 * An animated edge drawn round an element: a crackling electric outline, a
 * pulsing glow, or a light tracing the border.
 */
export const BORDER_EFFECTS = ["electric", "glow", "trace"] as const;
export type BorderEffect = (typeof BORDER_EFFECTS)[number];

export const BORDER_EFFECT_LABELS: Record<BorderEffect, string> = { electric: "Electric", glow: "Glow", trace: "Tracing light" };

export const REVEAL_EFFECTS = ["appear", "fade", "rise", "zoom", "wipe"] as const;
export type RevealEffect = (typeof REVEAL_EFFECTS)[number];

export const REVEAL_EFFECT_LABELS: Record<RevealEffect, string> = {
  appear: "Appear",
  fade: "Fade in",
  rise: "Rise",
  zoom: "Zoom",
  wipe: "Wipe",
};

export const FONTS = ["sans", "serif", "mono"] as const;
export type Font = (typeof FONTS)[number];

export const FONT_LABELS: Record<Font, string> = { sans: "Sans", serif: "Serif", mono: "Mono" };

const color = z.string().regex(/^#[0-9a-f]{6}$/i, "a #rrggbb colour");
const id = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);
const assetId = z.string().uuid();
const coord = z
  .number()
  .finite()
  .min(-STAGE.width)
  .max(STAGE.width * 2);
const length = z
  .number()
  .finite()
  .min(1)
  .max(STAGE.width * 2);

const revealSchema = z.discriminatedUnion("on", [
  z.object({ on: z.literal("next"), order: z.number().int().min(1).max(999), effect: z.enum(REVEAL_EFFECTS) }),
  z.object({ on: z.literal("click"), by: id, effect: z.enum(REVEAL_EFFECTS) }),
]);
export type Reveal = z.infer<typeof revealSchema>;

export const elementSchema = z.object({
  id,
  kind: z.enum(ELEMENT_KINDS),
  x: coord,
  y: coord,
  w: length,
  h: length,
  rotation: z.number().finite().min(-360).max(360).default(0),
  fill: color.nullable(),
  stroke: color.nullable(),
  strokeWidth: z.number().finite().min(0).max(80),
  /** Corner radius of a rectangle, in stage pixels. */
  radius: z.number().finite().min(0).max(STAGE.height),
  text: z.string().max(PAGE_LIMITS.text),
  font: z.enum(FONTS),
  fontSize: z.number().finite().min(8).max(400),
  bold: z.boolean(),
  textColor: color,
  align: z.enum(["left", "center", "right"]),
  valign: z.enum(["top", "middle", "bottom"]),
  reveal: revealSchema.nullable(),
  /** The picture an `image` element shows: a `presentation_assets` id. */
  src: assetId.nullable().default(null),
  border: z
    .object({ effect: z.enum(BORDER_EFFECTS), color })
    .nullable()
    .default(null),
});
export type PageElement = z.infer<typeof elementSchema>;

export const pageDocumentSchema = z
  .object({
    background: color,
    /** A picture filling the stage under every element: a converted slide's background. */
    backgroundImage: assetId.nullable().default(null),
    elements: z.array(elementSchema).max(PAGE_LIMITS.elements),
  })
  .superRefine((doc, ctx) => {
    const ids = new Set<string>();
    doc.elements.forEach((el, i) => {
      if (ids.has(el.id)) ctx.addIssue({ code: "custom", path: ["elements", i, "id"], message: "repeats another element's id" });
      ids.add(el.id);
    });
    doc.elements.forEach((el, i) => {
      if (el.reveal?.on !== "click") return;
      if (el.reveal.by === el.id)
        ctx.addIssue({ code: "custom", path: ["elements", i, "reveal", "by"], message: "an element cannot reveal itself" });
      else if (!ids.has(el.reveal.by))
        ctx.addIssue({ code: "custom", path: ["elements", i, "reveal", "by"], message: "names no element on the page" });
    });
  });
export type PageDocument = z.infer<typeof pageDocumentSchema>;

export const EMPTY_PAGE: PageDocument = { background: "#ffffff", backgroundImage: null, elements: [] };

/** The pictures a page draws, its background's and its elements', for the routes that check they are the presentation's. */
export const pageAssets = (doc: PageDocument): string[] =>
  [doc.backgroundImage, ...doc.elements.map((el) => (el.kind === "image" ? el.src : null))].filter((a): a is string => Boolean(a));

/** A new element of `kind`, centred on the stage, with `id`. */
export function newElement(kind: ElementKind, elementId: string): PageElement {
  const text = kind === "text";
  const w = text ? 900 : 480;
  const h = text ? 160 : 300;
  return {
    id: elementId,
    kind,
    x: (STAGE.width - w) / 2,
    y: (STAGE.height - h) / 2,
    w,
    h,
    rotation: 0,
    fill: text ? null : "#1f6feb",
    stroke: null,
    strokeWidth: 0,
    radius: kind === "rect" ? 24 : 0,
    text: text ? "Text" : "",
    font: "sans",
    fontSize: text ? 72 : 48,
    bold: false,
    textColor: text ? "#111111" : "#ffffff",
    align: "center",
    valign: "middle",
    reveal: null,
    src: null,
    border: null,
  };
}

export const REVEAL_GRID_SIZES = [4, 6, 8] as const;

/**
 * A title and `count` cards, each with an answer hidden on it that a click on
 * the card reveals, and a second click hides again: the slide of hidden
 * possibilities uncovered in whatever order the room picks. `nextId` names
 * each new element.
 */
export function revealGrid(count: (typeof REVEAL_GRID_SIZES)[number], nextId: () => string): PageElement[] {
  const cols = count === 4 ? 2 : count === 6 ? 3 : 4;
  const rows = count / cols;
  const margin = 120;
  const top = 250;
  const gap = 40;
  const cardW = (STAGE.width - 2 * margin - (cols - 1) * gap) / cols;
  const cardH = (STAGE.height - top - 90 - (rows - 1) * gap) / rows;
  const title: PageElement = {
    ...newElement("text", nextId()),
    x: margin,
    y: 80,
    w: STAGE.width - 2 * margin,
    h: 130,
    text: "Title",
    fontSize: 84,
    bold: true,
    align: "left",
  };
  const cards = Array.from({ length: count }, (_, i): PageElement[] => {
    const x = Math.round(margin + (i % cols) * (cardW + gap));
    const y = Math.round(top + Math.floor(i / cols) * (cardH + gap));
    const card: PageElement = {
      ...newElement("rect", nextId()),
      x,
      y,
      w: Math.round(cardW),
      h: Math.round(cardH),
      text: `Option ${i + 1}`,
      fontSize: cols === 4 ? 44 : 52,
      bold: true,
      valign: "top",
    };
    const answer: PageElement = {
      ...newElement("text", nextId()),
      x: x + 24,
      y: Math.round(y + cardH * 0.42),
      w: Math.round(cardW - 48),
      h: Math.round(cardH * 0.5),
      text: `Answer ${i + 1}`,
      fontSize: cols === 4 ? 34 : 40,
      textColor: "#ffffff",
      reveal: { on: "click", by: card.id, effect: "rise" },
    };
    return [card, answer];
  }).flat();
  return [title, ...cards];
}

/** Where the page stands while it is shown: how many "on next" reveals are out, and which triggers are clicked open. */
export type RevealState = { step: number; clicked: string[] };

export const START: RevealState = { step: 0, clicked: [] };

/** The "on next" elements, in the order the presses reveal them: by their order, then by their place in the stack. */
export function nextReveals(doc: PageDocument): PageElement[] {
  return doc.elements
    .map((el, index) => ({ el, index }))
    .filter(({ el }) => el.reveal?.on === "next")
    .sort((a, b) => (a.el.reveal as { order: number }).order - (b.el.reveal as { order: number }).order || a.index - b.index)
    .map(({ el }) => el);
}

/**
 * The presses a page takes before the next one moves on. Elements sharing an
 * order come in together, on one press.
 */
export function revealSteps(doc: PageDocument): number[][] {
  const steps: number[][] = [];
  let last: number | null = null;
  for (const el of nextReveals(doc)) {
    const order = (el.reveal as { order: number }).order;
    if (order !== last) steps.push([]);
    steps[steps.length - 1]!.push(doc.elements.indexOf(el));
    last = order;
  }
  return steps;
}

/** The ids of the elements whose click reveals something. */
export function triggers(doc: PageDocument): Set<string> {
  return new Set(doc.elements.flatMap((el) => (el.reveal?.on === "click" ? [el.reveal.by] : [])));
}

/** Whether `el` shows at `state`. */
export function isShown(doc: PageDocument, el: PageElement, state: RevealState): boolean {
  const reveal = el.reveal;
  if (!reveal) return true;
  if (reveal.on === "click") return state.clicked.includes(reveal.by);
  const index = doc.elements.indexOf(el);
  return revealSteps(doc)
    .slice(0, state.step)
    .some((step) => step.includes(index));
}

/** Every element shown, as the deck page's thumbnail and a page gone back to show it. */
export const builtState = (doc: PageDocument): RevealState => ({ step: revealSteps(doc).length, clicked: [...triggers(doc)] });

/** A click on `triggerId`: what it reveals opens, or closes again if it was open. */
export function toggleTrigger(state: RevealState, triggerId: string): RevealState {
  const clicked = state.clicked.includes(triggerId) ? state.clicked.filter((t) => t !== triggerId) : [...state.clicked, triggerId];
  return { ...state, clicked };
}
