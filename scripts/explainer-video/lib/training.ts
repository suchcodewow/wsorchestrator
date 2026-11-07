// Training videos: the app itself on screen, driven step by step, with a drawn cursor timed to the narration.
// A video lists its steps per scene (`ShotList`); `cli/capture.ts` performs them in a real browser against a
// demo deployment and writes what each one looked like (`Capture`); `src/Screen.tsx` plays them back, each step
// landing on the spoken phrase it names. See TRAINING.md.

/** A Playwright selector, as `page.locator` takes it: `role=tab[name="One Track"]`, `text=Me`, or CSS. */
export type Target = string;

type Anchored = {
  /** The spoken phrase the step lands on: a click clicks as it starts. It must be in the scene's text. */
  at: string;
  nth?: number;
  /** Zooms the picture in on the target (1.6 = 160%) from this step on, until a step sets 1. */
  zoom?: number;
};

export type Step =
  /** Loads a page. Only as a scene's first step; it is not shown happening. */
  | { do: "goto"; path: string }
  /** Moves the cursor onto the target and clicks it. */
  | ({ do: "click"; target: Target } & Anchored)
  /** Moves the cursor onto the target without clicking: what it reveals on hover is shown. */
  | ({ do: "hover"; target: Target } & Anchored)
  /** Moves the cursor onto the target and rings it, to point something out. */
  | ({ do: "point"; target: Target } & Anchored)
  /** Clicks into the target and types, a character at a time. */
  | ({ do: "type"; target: Target; text: string } & Anchored)
  /** Scrolls the page (or the target's scroll area) by `by` CSS pixels. */
  | ({ do: "scroll"; target?: Target; by: number } & Anchored)
  /** Presses a key, such as Escape. */
  | ({ do: "press"; key: string } & Anchored);

export type ShotList = {
  /** The page the browser starts on, before the first scene. */
  start: string;
  scenes: Step[][];
};

/** A box in the picture's pixels (the viewport times the device scale). */
export type Box = { x: number; y: number; w: number; h: number };

export type CapturedStep = {
  /** Where the cursor goes: the target's box, or null for a step with no target. */
  box: Box | null;
  /** The picture once the step is done, relative to public/. */
  after: string;
  /** For typing: the picture after each character. */
  frames?: string[];
};

export type Capture = {
  id: string;
  width: number;
  height: number;
  scenes: { start: string; steps: CapturedStep[] }[];
};

/** What the browser shows, in CSS pixels; the picture is 1920x1080 at this scale. */
export const VIEWPORT = { width: 1600, height: 900, scale: 1.2 } as const;

export const captureFile = (id: string) => `training/${id}/capture.json`;
