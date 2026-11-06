/**
 * Makes a slide review slide from a seed, with no AI and nothing stored: the
 * seed picks a theme from `bank.ts`, five of its pairs and four or five of its
 * capabilities, then 10 to 15 mistakes. The same seed always makes the same
 * slide, so a seed is all a report or a comment needs to show the slide again.
 *
 * Each mistake comes from a rule: a kind of mistake (spelling, font, an icon
 * out of line...), the elements it can land on, and how to make it there. The
 * mistakes are dealt so a slide gets many kinds rather than many of one: every
 * kind once before any kind twice, and no kind more than twice. An element
 * takes at most one mistake, since clicking it is what fixes it, and a row
 * takes at most one that moves something, so two nudges never read as an
 * indent. A rule that can't apply to an element (a typo needs a long word, a
 * dropped apostrophe needs one to drop) passes, and the next is tried.
 */

import { SLIPS, THEMES, type Capability, type Row, type Theme } from "./bank";
import {
  FLAWS_PER_SLIDE,
  TITLE,
  type Extra,
  type Flaw,
  type FlawKind,
  type Look,
  type RowIndex,
  type Side,
  type Slide,
  type SlideFont,
  type Target,
} from "./slides";

/** Seeds run from 1 to this, the largest a Postgres integer holds. */
export const SEED_MAX = 2_147_483_647;

export const isSeed = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= SEED_MAX;

/** A fresh seed for the next slide. */
export function newSeed(): number {
  const [n] = crypto.getRandomValues(new Uint32Array(1));
  return (n! % SEED_MAX) + 1;
}

// ---------------------------------------------------------------- randomness

type Rng = {
  /** From 0 up to, not including, 1. */
  next: () => number;
  /** A whole number from 0 up to, not including, `n`. */
  int: (n: number) => number;
  pick: <T>(xs: readonly T[]) => T;
  shuffle: <T>(xs: readonly T[]) => T[];
};

/** Mulberry32: small, fast and the same on every machine, which is all a seed needs. */
function rngFrom(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n: number) => Math.floor(next() * n);
  return {
    next,
    int,
    pick: (xs) => xs[int(xs.length)]!,
    shuffle: (xs) => {
      const out = [...xs];
      for (let i = out.length - 1; i > 0; i--) {
        const j = int(i + 1);
        [out[i], out[j]] = [out[j]!, out[i]!];
      }
      return out;
    },
  };
}

// ---------------------------------------------------------------- what a mistake can land on

type Slot =
  | "title"
  | "subtitle"
  | "logo"
  | "header"
  | "headerIcon"
  | "head"
  | "sub"
  | "icon"
  | "capsTitle"
  | "cap"
  | "box"
  | "arrow"
  | "divider"
  | "extra";

type El = {
  target: Target;
  slot: Slot;
  side?: Side;
  /** Which row a row's piece is in, for keeping moves apart. */
  group?: string;
  /** The words it shows when it is right; a capability's lead-in. */
  text?: string;
  /** A capability's measure. */
  metric?: string;
};

function elementsOf(current: Row[], future: Row[], capabilities: Capability[], subtitle: string): El[] {
  const els: El[] = [
    { target: "title", slot: "title", text: TITLE },
    { target: "subtitle", slot: "subtitle", text: subtitle },
    { target: "logo", slot: "logo" },
    { target: "header.current", slot: "header", side: "current", text: "Current state" },
    { target: "header.future", slot: "header", side: "future", text: "Future state" },
    { target: "headerIcon.current", slot: "headerIcon", side: "current" },
    { target: "headerIcon.future", slot: "headerIcon", side: "future" },
    { target: "capabilitiesTitle", slot: "capsTitle", text: "Required capabilities" },
    { target: "capabilitiesBox", slot: "box" },
    { target: "arrow", slot: "arrow" },
    { target: "divider", slot: "divider" },
    { target: "extra", slot: "extra" },
  ];
  for (const [side, rows] of [["current", current], ["future", future]] as const) {
    rows.forEach((row, i) => {
      const group = `${side}.${i}`;
      const at = (part: "head" | "sub" | "icon"): Target => `${side}.${i as RowIndex}.${part}`;
      els.push({ target: at("head"), slot: "head", side, group, text: row.head });
      els.push({ target: at("sub"), slot: "sub", side, group, text: row.sub });
      els.push({ target: at("icon"), slot: "icon", side, group });
    });
  }
  capabilities.forEach((cap, i) =>
    els.push({ target: `capability.${i}`, slot: "cap", group: `capability.${i}`, text: cap.lead, metric: cap.metric }),
  );
  return els;
}

// ---------------------------------------------------------------- the rules

type Made = { look: Look; note: string; extra?: Extra };

type Rule = {
  kind: FlawKind;
  slots: readonly Slot[];
  /** Moves the element; a row takes at most one of these. */
  moves?: boolean;
  make: (el: El, rng: Rng) => Made | null;
};

const TEXT_SLOTS = ["title", "subtitle", "header", "head", "sub", "capsTitle", "cap"] as const;
const LINE_SLOTS = ["head", "sub", "cap"] as const;

/** What the reader calls each kind of line, for notes. */
const LINE_NAME: Partial<Record<Slot, string>> = {
  head: "headlines",
  sub: "outcome lines",
  cap: "capabilities",
};
const lineName = (el: El) => LINE_NAME[el.slot] ?? "lines";

/** A word of a line, where it sits. */
type Word = { word: string; start: number; end: number };

function wordsOf(text: string): Word[] {
  return [...text.matchAll(/[A-Za-z][A-Za-z’-]*/g)].map((m) => ({ word: m[0], start: m.index, end: m.index + m[0].length }));
}

const replaceWord = (text: string, w: Word, by: string) => text.slice(0, w.start) + by + text.slice(w.end);

/** For a capability, the words are in its lead-in or its measure: a mistake in either is a mistake in the line. */
function textOf(el: El, rng: Rng): { text: string; set: (t: string) => Look } | null {
  if (el.text === undefined) return null;
  if (el.slot === "cap" && el.metric && rng.next() < 0.4) return { text: el.metric, set: (t) => ({ metric: t }) };
  return { text: el.text, set: (t) => ({ text: t }) };
}

/** Classic misspellings of words the bank uses, by the right spelling. */
const MISSPELLINGS: Record<string, string> = {
  knowledge: "knowlege",
  environment: "enviroment",
  environments: "enviroments",
  infrastructure: "infrastucture",
  automatically: "automaticaly",
  vulnerabilities: "vulnerabilites",
  management: "managment",
  minutes: "minuets",
  customers: "costumers",
  traffic: "trafic",
  separately: "seperately",
  separate: "seperate",
  necessary: "neccessary",
  governance: "governence",
  compliance: "complience",
  deployments: "deployements",
  dependencies: "dependancies",
  consistent: "consistant",
  calendar: "calender",
  occurring: "occuring",
  successful: "succesful",
  experiments: "experiements",
  available: "availible",
  recovery: "recovary",
  release: "realease",
  quarter: "quater",
  approval: "aproval",
  approvals: "aprovals",
  production: "prodution",
  pipelines: "pipleines",
  pipeline: "pipleine",
};

const matchCase = (like: string, word: string) => (like[0] === like[0]!.toUpperCase() ? word[0]!.toUpperCase() + word.slice(1) : word);

/** A slip of the fingers in a long lower-case word: a letter dropped, two swapped, or one doubled. */
function typo(word: string, rng: Rng): string | null {
  if (word.length < 6 || !/^[a-z]+$/i.test(word) || word === word.toUpperCase()) return null;
  const i = 1 + rng.int(word.length - 3);
  const ops = [
    () => word.slice(0, i) + word.slice(i + 1),
    () => (word[i] === word[i + 1] ? null : word.slice(0, i) + word[i + 1] + word[i] + word.slice(i + 2)),
    () => word.slice(0, i) + word[i] + word.slice(i),
  ];
  for (const op of rng.shuffle(ops)) {
    const out = op();
    if (out && out.toLowerCase() !== word.toLowerCase()) return out;
  }
  return null;
}

/** Grammar slips any line can carry, when it has the word: [what, wrong, note]. */
const GRAMMAR_SWAPS: [RegExp, string, string][] = [
  [/\bits\b/, "it’s", "“it’s” means “it is”; this should be “its”."],
  [/\btheir\b/, "there", "“there” should be “their”."],
  [/\baffects\b/, "effects", "“effects” should be “affects”."],
  [/\bfewer\b/, "less", "“less” should be “fewer”: these can be counted."],
  [/\ban (?=[aeiou])/, "a ", "“a” should be “an” before a vowel."],
];

/** British spellings, by the American ones the slide is written in. */
const BRITISH: Record<string, string> = {
  utilization: "utilisation",
  optimization: "optimisation",
  normalized: "normalised",
  prioritized: "prioritised",
  prioritize: "prioritise",
  artifact: "artefact",
  artifacts: "artefacts",
  catalog: "catalogue",
  analyze: "analyse",
  rightsized: "rightsised",
  summarized: "summarised",
  organization: "organisation",
};

/** Names and acronyms written one way, by the wrong way to write them. */
const MISCASED: Record<string, string> = {
  AI: "Ai",
  SBOM: "Sbom",
  SLOs: "Slos",
  SLA: "Sla",
  SQL: "Sql",
  API: "Api",
  APIs: "Apis",
  UI: "Ui",
  CVEs: "Cves",
  DBA: "Dba",
  Git: "GIT",
  GitOps: "Gitops",
  DevOps: "Devops",
  Terraform: "terraform",
  Kubernetes: "kubernetes",
  OPA: "Opa",
  SLSA: "Slsa",
  TechDocs: "Techdocs",
  AutoStopping: "Autostopping",
};

/** Words that end in "s" where an apostrophe would be right, or that aren't plurals at all. */
const NOT_PLURAL = new Set([
  "is", "has", "was", "this", "us", "its", "does", "less", "unless", "across", "always", "status", "process",
  "analysis", "towards", "perhaps", "various", "focus", "plus", "yes", "access", "success", "business", "minus",
]);

const SMALL_WORDS = new Set(["a", "an", "and", "as", "at", "by", "for", "in", "of", "on", "or", "the", "to", "via", "vs"]);

function titleCase(text: string): string {
  let first = true;
  return text.replace(/[A-Za-z][A-Za-z’-]*/g, (w) => {
    const out = first || !SMALL_WORDS.has(w.toLowerCase()) ? w[0]!.toUpperCase() + w.slice(1) : w;
    first = false;
    return out;
  });
}

const FONT_NAME: Record<SlideFont, string> = {
  geist: "Geist",
  "geist-mono": "Geist Mono",
  georgia: "Georgia",
  arial: "Arial",
  times: "Times New Roman",
  verdana: "Verdana",
  courier: "Courier New",
  comic: "Comic Sans",
};

/** What each slot is set in, and the wrong fonts that stand out against it at this size. */
const FONTS: Partial<Record<Slot, { base: SlideFont; wrong: SlideFont[] }>> = {
  title: { base: "georgia", wrong: ["arial", "verdana", "comic"] },
  subtitle: { base: "georgia", wrong: ["arial", "verdana", "courier"] },
  header: { base: "geist-mono", wrong: ["geist", "times", "comic"] },
  capsTitle: { base: "geist-mono", wrong: ["georgia", "geist", "comic"] },
  head: { base: "geist", wrong: ["times", "courier", "comic", "verdana"] },
  sub: { base: "geist", wrong: ["times", "courier", "comic", "verdana"] },
  cap: { base: "geist", wrong: ["times", "courier", "comic", "verdana"] },
};

/** A size far enough from the slot's own to see: [bigger, smaller]. */
const SIZES: Partial<Record<Slot, [number, number]>> = {
  title: [52, 30],
  subtitle: [22, 13],
  head: [20, 12.5],
  sub: [15.5, 10],
  cap: [17.5, 11],
};

/** Wrong colors, and what each looks like next to text that is the right one. */
const COLORS: { color: string; name: string }[] = [
  { color: "#2563eb", name: "Blue text" },
  { color: "#dc2626", name: "Red text" },
  { color: "#c2410c", name: "Orange text" },
  { color: "#9b9b97", name: "Grey" },
  { color: "#d4d4d0", name: "So pale it is hard to read:" },
];

const STICKIES = ["TODO: check metric w/ Priya", "Confirm numbers with Dana?", "Is this still true?", "Ask Tomas re: pricing", "Swap for the new logo"];

const markName = (side: Side) => (side === "current" ? "cross" : "tick");

const RULES: Rule[] = [
  // ------------------------------------------------ spelling
  {
    kind: "spelling",
    slots: ["title", "subtitle", "head", "sub", "cap"],
    make: (el, rng) => {
      const t = textOf(el, rng);
      if (!t) return null;
      const words = rng.shuffle(wordsOf(t.text));
      const known = words.find((w) => MISSPELLINGS[w.word.toLowerCase()]);
      if (known) {
        const wrong = matchCase(known.word, MISSPELLINGS[known.word.toLowerCase()]!);
        return { look: t.set(replaceWord(t.text, known, wrong)), note: `“${wrong}” should be “${known.word}”.` };
      }
      for (const w of words) {
        const wrong = typo(w.word, rng);
        if (wrong) return { look: t.set(replaceWord(t.text, w, wrong)), note: `“${wrong}” should be “${w.word}”.` };
      }
      return null;
    },
  },
  // ------------------------------------------------ grammar
  {
    kind: "grammar",
    slots: LINE_SLOTS,
    make: (el, rng) => {
      const slip = el.text ? SLIPS[el.text]?.grammar : undefined;
      if (slip) return { look: { text: slip[0] }, note: slip[1] };
      const t = textOf(el, rng);
      if (!t) return null;
      for (const [find, wrong, note] of rng.shuffle(GRAMMAR_SWAPS)) {
        if (find.test(t.text)) return { look: t.set(t.text.replace(find, wrong)), note };
      }
      return null;
    },
  },
  // ------------------------------------------------ punctuation
  {
    kind: "punctuation",
    slots: ["title"],
    make: (_el, rng) =>
      rng.next() < 0.5
        ? { look: { text: "Our understanding.." }, note: "Two full stops where the template has an ellipsis." }
        : { look: { text: "Our understanding" }, note: "The ellipsis is missing from the title." },
  },
  {
    kind: "punctuation",
    slots: LINE_SLOTS,
    make: (el, rng) => {
      const t = textOf(el, rng);
      if (!t) return null;
      const words = rng.shuffle(wordsOf(t.text));
      // An apostrophe dropped...
      const owned = words.find((w) => w.word.includes("’"));
      if (owned && rng.next() < 0.6) {
        const wrong = owned.word.replace("’", "");
        return { look: t.set(replaceWord(t.text, owned, wrong)), note: `“${wrong}” is missing its apostrophe.` };
      }
      // ...or one added to a word that only ends in s.
      const plural = words.find(
        (w) => w.word.length >= 5 && /[a-z]s$/.test(w.word) && !/ss$/.test(w.word) && !w.word.includes("’") && !NOT_PLURAL.has(w.word.toLowerCase()),
      );
      if (!plural) return null;
      const wrong = `${plural.word.slice(0, -1)}’s`;
      return { look: t.set(replaceWord(t.text, plural, wrong)), note: `An apostrophe has crept into “${wrong}”: nothing here belongs to anyone.` };
    },
  },
  // ------------------------------------------------ capitalization
  {
    kind: "capitalization",
    slots: ["title", "header", "capsTitle", "head", "sub", "cap"],
    make: (el, rng) => {
      const t = textOf(el, rng);
      if (!t) return null;
      const titled = titleCase(t.text);
      if (titled === t.text) return null;
      const note =
        el.slot === "header"
          ? `Title case; the other heading is sentence case.`
          : el.slot === "title" || el.slot === "capsTitle"
            ? "Title case; the template’s headings are sentence case."
            : `Title case; the other ${lineName(el)} are sentence case.`;
      return { look: t.set(titled), note };
    },
  },
  {
    kind: "capitalization",
    slots: LINE_SLOTS,
    make: (el) => {
      const text = el.text;
      const first = text ? wordsOf(text)[0] : undefined;
      if (!text || !first || first.word === first.word.toUpperCase() || first.word[0] !== first.word[0]!.toUpperCase()) return null;
      return { look: { text: text[0]!.toLowerCase() + text.slice(1) }, note: "Starts with a lower-case letter." };
    },
  },
  {
    kind: "capitalization",
    slots: ["subtitle", "head", "sub", "cap"],
    make: (el, rng) => {
      const t = textOf(el, rng);
      if (!t) return null;
      const named = rng.shuffle(wordsOf(t.text)).find((w) => MISCASED[w.word]);
      if (!named) return null;
      const wrong = MISCASED[named.word]!;
      return { look: t.set(replaceWord(t.text, named, wrong)), note: `“${wrong}” should be “${named.word}”.` };
    },
  },
  // ------------------------------------------------ consistency
  {
    kind: "consistency",
    slots: ["head", "sub", "cap"],
    make: (el, rng) => {
      const t = textOf(el, rng);
      if (!t) return null;
      const us = rng.shuffle(wordsOf(t.text)).find((w) => BRITISH[w.word.toLowerCase()]);
      if (us) {
        const wrong = matchCase(us.word, BRITISH[us.word.toLowerCase()]!);
        return { look: t.set(replaceWord(t.text, us, wrong)), note: `British “${wrong}” on a slide written in American English.` };
      }
      if (t.text.includes("zero-day")) return { look: t.set(t.text.replace("zero-day", "0-day")), note: "“0-day”, where the slide’s style is “zero-day”." };
      return null;
    },
  },
  {
    kind: "consistency",
    slots: ["cap"],
    make: (el, rng) => {
      const choices: Made[] = [
        { look: { arrow: "->" }, note: "A typed “->” where the other lines use the → arrow." },
        { look: { arrow: "=>" }, note: "A “=>” where the other lines use the → arrow." },
        { look: { bullet: "–" }, note: "A dash for a bullet where the others are dots." },
        { look: { bullet: "○" }, note: "A hollow bullet where the others are solid." },
        { look: { metric: "" }, note: "No measure: every other capability says how it will be tracked." },
      ];
      if (el.metric?.startsWith("# of ")) {
        choices.push({ look: { metric: `Number of ${el.metric.slice(5)}` }, note: "“Number of” spelled out where the other measures use “#”." });
      }
      return rng.pick(choices);
    },
  },
  {
    kind: "consistency",
    slots: ["box"],
    make: () => ({ look: { solid: true }, note: "A solid edge where the template’s box is dashed." }),
  },
  // ------------------------------------------------ font, size, bold or italic, color
  {
    kind: "font",
    slots: TEXT_SLOTS,
    make: (el, rng) => {
      const f = FONTS[el.slot];
      if (!f) return null;
      const font = rng.pick(f.wrong);
      const where = el.slot === "title" ? "; the template’s title font is Georgia" : ` instead of ${FONT_NAME[f.base]}`;
      return { look: { font }, note: `Set in ${FONT_NAME[font]}${where}.` };
    },
  },
  {
    kind: "size",
    slots: ["title", "subtitle", "head", "sub", "cap"],
    make: (el, rng) => {
      const s = SIZES[el.slot];
      if (!s) return null;
      const bigger = rng.next() < 0.5;
      const of = el.slot === "title" || el.slot === "subtitle" ? `the template’s ${el.slot}` : `the other ${lineName(el)}`;
      return { look: { size: bigger ? s[0] : s[1] }, note: `${bigger ? "Larger" : "Smaller"} than ${of}.` };
    },
  },
  {
    kind: "size",
    slots: ["arrow"],
    make: () => ({ look: { scale: 1.8 }, note: "The arrow is bigger than the template’s." }),
  },
  {
    kind: "style",
    slots: LINE_SLOTS,
    make: (el, rng) => {
      const choices: Made[] =
        el.slot === "sub"
          ? [
              { look: { italic: false }, note: "Not italic, unlike the other outcome lines." },
              { look: { weight: 700 }, note: "Bold, where the other outcome lines are regular weight." },
            ]
          : [
              { look: { weight: 800 }, note: `Bold, where the other ${lineName(el)} are ${el.slot === "head" ? "medium" : "regular"} weight.` },
              { look: { italic: true }, note: `Italic, unlike the other ${lineName(el)}.` },
            ];
      return rng.pick(choices);
    },
  },
  {
    kind: "color",
    slots: ["subtitle", "head", "sub", "cap"],
    make: (el, rng) => {
      const c = rng.pick(el.slot === "subtitle" ? COLORS.slice(0, 3) : COLORS);
      const right = el.slot === "subtitle" ? "the template’s subtitle is grey" : `the other ${lineName(el)} are black`;
      return { look: { color: c.color }, note: c.name.endsWith(":") ? `${c.name} ${right}.` : `${c.name} where ${right}.` };
    },
  },
  // ------------------------------------------------ alignment and spacing
  {
    kind: "alignment",
    slots: ["title", "subtitle", "capsTitle"],
    moves: true,
    make: (el) => ({
      look: { dx: el.slot === "subtitle" ? 28 : 24 },
      note: el.slot === "capsTitle" ? "Indented from the capabilities below it." : el.slot === "subtitle" ? "Indented from the title’s left edge." : "Indented from the slide’s left margin.",
    }),
  },
  {
    kind: "alignment",
    slots: LINE_SLOTS,
    moves: true,
    make: (el, rng) => {
      const right = el.slot !== "head" || rng.next() < 0.6;
      const dx = (18 + rng.int(7)) * (right ? 1 : -1);
      return {
        look: { dx },
        note: right ? `Indented further than the other ${lineName(el)}.` : "Pulled left of the column’s edge.",
      };
    },
  },
  {
    kind: "alignment",
    slots: ["header"],
    moves: true,
    make: () => ({ look: { dy: 9 }, note: "Sits lower than the heading beside it." }),
  },
  {
    kind: "alignment",
    slots: ["icon"],
    moves: true,
    make: (el, rng) => {
      const mark = markName(el.side!);
      return rng.pick<Made>([
        { look: { dx: 14 }, note: `This ${mark} sits right of the others.` },
        { look: { dx: -12 }, note: `This ${mark} sits left of the others.` },
        { look: { dy: 9 }, note: `This ${mark} sits lower than its line.` },
      ]);
    },
  },
  {
    kind: "alignment",
    slots: ["box", "divider", "arrow", "logo"],
    moves: true,
    make: (el) =>
      el.slot === "box"
        ? { look: { dx: 30 }, note: "The box is shifted right, past the slide’s right margin." }
        : el.slot === "divider"
          ? { look: { dx: 40 }, note: "The column divider is off-center, so the arrow no longer sits on it." }
          : el.slot === "arrow"
            ? { look: { dx: 40 }, note: "The arrow has drifted off the divider between the columns." }
            : { look: { dx: -40, dy: 18 }, note: "The logo has moved in from the right margin and down from the title line." },
  },
  {
    kind: "spacing",
    slots: LINE_SLOTS,
    make: (el, rng) => {
      const t = textOf(el, rng);
      if (!t) return null;
      if (t.text.includes(", ") && rng.next() < 0.4) {
        return { look: t.set(t.text.replace(", ", "  ,  ")), note: "Spaces before the comma." };
      }
      const gaps = [...t.text.matchAll(/[A-Za-z’] (?=[A-Za-z#%])/g)].map((m) => m.index + 1);
      if (!gaps.length) return null;
      const at = rng.pick(gaps);
      const before = t.text.slice(0, at).split(" ").at(-1);
      const after = t.text.slice(at + 1).split(" ")[0];
      return { look: t.set(`${t.text.slice(0, at)}     ${t.text.slice(at + 1)}`), note: `A run of extra spaces between “${before}” and “${after}”.` };
    },
  },
  {
    kind: "spacing",
    slots: ["head", "sub", "cap"],
    moves: true,
    make: (el, rng) =>
      el.slot === "sub"
        ? rng.pick<Made>([
            { look: { dy: -7 }, note: "Crowds its headline: the gap is smaller than in the other rows." },
            { look: { dy: 10 }, note: "Sits further below its headline than the other rows do." },
          ])
        : el.slot === "cap"
          ? { look: { dy: 9 }, note: "This line sits lower than the even spacing of the others." }
          : rng.pick<Made>([
              { look: { dy: -9 }, note: "This row sits higher than the even spacing of the others." },
              { look: { dy: 10 }, note: "This row sits lower than the even spacing of the others." },
            ]),
  },
  // ------------------------------------------------ icons and layout
  {
    kind: "icon",
    slots: ["icon"],
    make: (el, rng) => {
      const side = el.side!;
      const mark = markName(side);
      return rng.pick<Made>([
        side === "current"
          ? { look: { icon: "check" }, note: "A green tick on a current-state problem; it should be the red cross." }
          : { look: { icon: "cross" }, note: "A red cross on a future-state outcome; it should be the green tick." },
        { look: { scale: 2 }, note: `This ${mark} is bigger than the others.` },
        { look: { scale: 0.45 }, note: `This ${mark} is smaller than the others.` },
      ]);
    },
  },
  {
    kind: "icon",
    slots: ["headerIcon"],
    make: (el, rng) =>
      rng.next() < 0.5
        ? el.side === "current"
          ? { look: { icon: "check" }, note: "Both headings carry a tick; current state should have the red cross." }
          : { look: { icon: "cross" }, note: "Both headings carry a cross; future state should have the green tick." }
        : { look: { scale: 1.7 }, note: "This heading’s icon is bigger than the one beside it." },
  },
  {
    kind: "icon",
    slots: ["arrow"],
    make: () => ({ look: { pointLeft: true }, note: "The arrow points back from the future state to the current one." }),
  },
  {
    kind: "layout",
    slots: ["logo"],
    make: (_el, rng) =>
      rng.next() < 0.5
        ? { look: { stretch: 1.5 }, note: "The Harness logo is stretched out of proportion." }
        : { look: { stretch: 0.6 }, note: "The Harness logo is squashed out of proportion." },
  },
  {
    kind: "layout",
    slots: ["head"],
    make: (el) => {
      const long = el.text ? SLIPS[el.text]?.long : undefined;
      if (!long) return null;
      const runs = el.side === "current" ? "across the divider into the future state" : "past the slide’s right margin";
      return { look: { text: long }, note: `Too long for its column: it runs ${runs}.` };
    },
  },
  // ------------------------------------------------ left behind
  {
    kind: "leftover",
    slots: ["head", "sub"],
    make: (el, rng) =>
      el.slot === "sub" && rng.next() < 0.5
        ? { look: { underline: true, color: "#2563eb" }, note: "Underlined in blue like a stray hyperlink." }
        : { look: { highlight: true }, note: "A yellow highlight left over from an edit." },
  },
  {
    kind: "leftover",
    slots: ["extra"],
    make: (_el, rng) =>
      rng.pick<Made>([
        { look: {}, note: "An empty “Click to add text” box was left on the slide.", extra: { text: "Click to add text", x: 960, y: 566, style: "placeholder" } },
        { look: {}, note: "A “[Customer logo]” placeholder was never filled in or removed.", extra: { text: "[Customer logo]", x: 900, y: 66, style: "placeholder" } },
        { look: {}, note: "A sticky note from a review was never deleted.", extra: { text: rng.pick(STICKIES), x: 690, y: 44, style: "sticky" } },
      ]),
  },
];

const KINDS = [...new Set(RULES.map((r) => r.kind))];

// ---------------------------------------------------------------- dealing the mistakes

function changesSomething(el: El, look: Look, extra?: Extra): boolean {
  if (extra) return true;
  if (look.text !== undefined && look.text === el.text) return false;
  if (look.metric !== undefined && look.metric === el.metric) return false;
  return Object.keys(look).length > 0;
}

/** The kinds a slide's mistakes are dealt from, in order: every kind once, shuffled, then some a second time. */
function dealKinds(count: number, rng: Rng): FlawKind[] {
  const first = rng.shuffle(KINDS);
  return [...first, ...rng.shuffle(KINDS)].slice(0, Math.max(count, first.length));
}

function placeFlaws(els: El[], rng: Rng): Flaw[] {
  const count = FLAWS_PER_SLIDE.min + rng.int(FLAWS_PER_SLIDE.max - FLAWS_PER_SLIDE.min + 1);
  const flaws: Flaw[] = [];
  const used = new Set<Target>();
  const moved = new Set<string>();
  const perKind = new Map<FlawKind, number>();

  const tryKind = (kind: FlawKind): boolean => {
    if ((perKind.get(kind) ?? 0) >= 2) return false;
    const rules = rng.shuffle(RULES.filter((r) => r.kind === kind));
    for (const rule of rules) {
      for (const el of rng.shuffle(els.filter((e) => rule.slots.includes(e.slot) && !used.has(e.target)))) {
        if (rule.moves && el.group && moved.has(el.group)) continue;
        const made = rule.make(el, rng);
        if (!made || !changesSomething(el, made.look, made.extra)) continue;
        flaws.push({ target: el.target, kind, note: made.note, look: made.look, ...(made.extra && { extra: made.extra }) });
        used.add(el.target);
        if (rule.moves && el.group) moved.add(el.group);
        perKind.set(kind, (perKind.get(kind) ?? 0) + 1);
        return true;
      }
    }
    return false;
  };

  for (const kind of dealKinds(count, rng)) {
    if (flaws.length >= count) break;
    tryKind(kind);
  }
  // A kind that found nowhere to land leaves the slide short: top it up from whichever kinds still have room.
  for (let guard = 0; flaws.length < count && guard < 50; guard++) tryKind(rng.pick(KINDS));
  return flaws;
}

/** The slide `seed` makes, mistakes and all. */
export function generateSlide(seed: number): Slide {
  const rng = rngFrom(seed);
  const theme: Theme = rng.pick(THEMES);
  const pairs = rng.shuffle(theme.pairs).slice(0, 5);
  const capabilities = rng.shuffle(theme.capabilities).slice(0, 4 + rng.int(2));
  const current = pairs.map((p) => p.current) as Slide["current"];
  const future = pairs.map((p) => p.future) as Slide["future"];
  const flaws = placeFlaws(elementsOf(current, future, capabilities, theme.subtitle), rng);
  return { seed, theme: theme.id, themeName: theme.name, subtitle: theme.subtitle, current, future, capabilities, flaws };
}
