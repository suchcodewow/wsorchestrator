/**
 * The nine Diagnostic subjects, the three tracks that weight them, and what a
 * placement routes someone to. Pure and free of any answer key, so the pages
 * share it with the server.
 */

import type { Form, Level } from "@/lib/iris/engine";

export const SUBJECT_KEYS = [
  "sdlc",
  "companies",
  "aisdlc",
  "pipegen",
  "champion",
  "harness",
  "messaging",
  "qualification",
  "tools",
] as const;
export type SubjectKey = (typeof SUBJECT_KEYS)[number];

export type Subject = {
  name: string;
  short: string;
  /** What it covers; null for a subject whose questions are not written yet. */
  blurb: string | null;
  /** Listed so takers know it is coming, but it has no questions yet. The bank test keeps this true. */
  comingSoon: boolean;
};

export const SUBJECTS: Record<SubjectKey, Subject> = {
  sdlc: {
    name: "SDLC",
    short: "SDLC",
    blurb: "How software gets built, tested, secured, shipped and run.",
    comingSoon: false,
  },
  companies: {
    name: "Companies that serve the SDLC",
    short: "Companies",
    blurb: "The DevOps and DevSecOps vendors you will meet in deals, and how their tools overlap.",
    comingSoon: false,
  },
  aisdlc: {
    name: "How AI has changed the SDLC",
    short: "AI SDLC",
    blurb: "AI coding tools and agents, where they change delivery, and the risks they bring.",
    comingSoon: false,
  },
  pipegen: {
    name: "Pipeline Generation",
    short: "Pipegen",
    blurb: "Territory planning, triggers, outbound quality and conversion.",
    comingSoon: false,
  },
  champion: {
    name: "Champion Building",
    short: "Champions",
    blurb: "Recognizing, developing and validating a champion who will advocate for you.",
    comingSoon: false,
  },
  harness: { name: "Harness Solution", short: "Harness", blurb: null, comingSoon: true },
  messaging: { name: "Messaging", short: "Messaging", blurb: null, comingSoon: true },
  qualification: { name: "Qualification", short: "Qualification", blurb: null, comingSoon: true },
  tools: { name: "Tools", short: "Tools", blurb: null, comingSoon: true },
};

/** The subjects with questions, in order: what can be taken, and what charts and tables show. */
export const OPEN_SUBJECT_KEYS = SUBJECT_KEYS.filter((k) => !SUBJECTS[k].comingSoon);

export function isSubjectKey(value: unknown): value is SubjectKey {
  return SUBJECT_KEYS.includes(value as SubjectKey);
}

export const LEVEL_LABELS: Record<Level, string> = { 1: "101", 2: "201", 3: "301" };

export const FORM_LABELS: Record<Form, string> = { A: "Form A", B: "Form B" };
export const FORM_USES: Record<Form, string> = { A: "entry and day 90 recheck", B: "day 30 checkpoint" };

export const TRACKS = ["AE", "SE", "SDR"] as const;
export type Track = (typeof TRACKS)[number];

export const TRACK_LABELS: Record<Track, string> = {
  AE: "Account Executive",
  SE: "Solutions Engineer",
  SDR: "Sales Development Rep",
};

export function isTrack(value: unknown): value is Track {
  return TRACKS.includes(value as Track);
}

/** Every subject counts the same for every track, until real weights are decided. */
const EQUAL = Object.fromEntries(SUBJECT_KEYS.map((k) => [k, 1])) as Record<SubjectKey, number>;

/** How much each subject counts toward someone's overall score, by track. */
export const TRACK_WEIGHTS: Record<Track, Record<SubjectKey, number>> = { AE: EQUAL, SE: EQUAL, SDR: EQUAL };

/** The weighted share of the top level reached across the subjects placed so far, 0–100; null before any weighted subject. */
export function compositeOf(placements: Partial<Record<SubjectKey, Level>>, track: Track): number | null {
  const weights = TRACK_WEIGHTS[track];
  let num = 0;
  let den = 0;
  for (const key of SUBJECT_KEYS) {
    const level = placements[key];
    const weight = weights[key];
    if (!level || !weight) continue;
    num += weight * level;
    den += weight * 3;
  }
  return den ? Math.round((num / den) * 100) : null;
}

export function bandOf(composite: number | null): string {
  if (composite === null) return "Not enough subjects placed";
  if (composite < 50) return "Foundational";
  if (composite < 70) return "Ramping";
  if (composite < 85) return "Field ready";
  return "Advanced";
}

/** Where a placement routes someone, for the subjects that have a route yet. Placeholder tiers until the content exists. */
export const TRAINING: Partial<Record<SubjectKey, Record<Level, string>>> = {
  sdlc: {
    1: "Foundational SDLC track. Build, test, deploy, secure, operate explained from zero. Does not exist yet and is the first content to build.",
    2: "Existing SDLC material, reorganised into scored modules: CD problems, GitOps overview, SDLC whiteboard.",
    3: "Application under pressure. Toolchain teardowns from real customer calls, plus whiteboarding a broken delivery process live.",
  },
  pipegen: {
    1: "Tooling and activity expectations. Closest existing tier.",
    2: "Territory planning, triggers, outbound quality. Net new for AEs.",
    3: "Conversion analysis and coaching others. Net new.",
  },
};
