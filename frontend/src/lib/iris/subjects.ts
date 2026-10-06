/**
 * The eight Iris subjects, the three tracks that weight them, and what a
 * placement routes someone to. Pure and free of any answer key, so the pages
 * share it with the server.
 */

import type { Form, Level } from "@/lib/iris/engine";

export const SUBJECT_KEYS = ["sdlc", "industry", "sales", "dealmech", "cotm", "techai", "pipegen", "compete"] as const;
export type SubjectKey = (typeof SUBJECT_KEYS)[number];

export const SUBJECTS: Record<SubjectKey, { name: string; short: string; blurb: string }> = {
  sdlc: {
    name: "SDLC Foundations",
    short: "SDLC",
    blurb: "How software gets built, tested, secured, shipped and run.",
  },
  industry: {
    name: "The Software Industry",
    short: "Industry",
    blurb: "Market structure, buyer personas, budget, vendor landscape.",
  },
  sales: {
    name: "Sales Fundamentals",
    short: "Sales",
    blurb: "Discovery, value selling, forecasting, negotiation, hygiene.",
  },
  dealmech: {
    name: "Discovery & Deal Mechanics",
    short: "Deals",
    blurb: "Qualification, champions, landing zones, multithreading, paper.",
  },
  cotm: {
    name: "Command of the Message",
    short: "CotM",
    blurb: "Value drivers, differentiators, proof points, talk track.",
  },
  techai: {
    name: "Technology & AI",
    short: "Tech & AI",
    blurb: "Models and agents, AI in the lifecycle, risk and governance.",
  },
  pipegen: {
    name: "Pipegen",
    short: "Pipegen",
    blurb: "Territory planning, triggers, outbound quality, conversion.",
  },
  compete: {
    name: "Competitive Landscape",
    short: "Compete",
    blurb: "Category map, win themes, loss patterns, trap setting.",
  },
};

export function isSubjectKey(value: unknown): value is SubjectKey {
  return SUBJECT_KEYS.includes(value as SubjectKey);
}

export const LEVEL_LABELS: Record<Level, string> = { 1: "Beginner", 2: "Intermediate", 3: "Advanced" };

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

/** How much each subject counts toward someone's overall score, by track. */
export const TRACK_WEIGHTS: Record<Track, Record<SubjectKey, number>> = {
  AE: { sdlc: 10, industry: 10, sales: 20, dealmech: 20, cotm: 15, techai: 10, pipegen: 10, compete: 5 },
  SE: { sdlc: 25, industry: 10, sales: 5, dealmech: 10, cotm: 15, techai: 20, pipegen: 0, compete: 15 },
  SDR: { sdlc: 10, industry: 15, sales: 10, dealmech: 5, cotm: 20, techai: 10, pipegen: 25, compete: 5 },
};

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

/** Where a placement routes someone. Placeholder tiers until the content exists. */
export const TRAINING: Record<SubjectKey, Record<Level, string>> = {
  sdlc: {
    1: "Foundational SDLC track. Build, test, deploy, secure, operate explained from zero. Does not exist yet and is the first content to build.",
    2: "Existing SDLC material, reorganised into scored modules: CD problems, GitOps overview, SDLC whiteboard.",
    3: "Application under pressure. Toolchain teardowns from real customer calls, plus whiteboarding a broken delivery process live.",
  },
  industry: {
    1: "Foundational market and persona primer. Net new.",
    2: "Analyst material and persona discovery guides, taught rather than filed.",
    3: "Executive-level consolidation and budget conversations. Live sessions.",
  },
  sales: {
    1: "Selling craft basics. Net new; nothing is taught today.",
    2: "Stage criteria and forecast discipline, plus discovery technique. Mostly net new.",
    3: "Committee close plans and negotiation. Live role play.",
  },
  dealmech: {
    1: "Qualification and champion basics. Net new.",
    2: "Champion testing, landing zones, paper process. Net new as instruction.",
    3: "Multithreading sequence and trap placement. Deal clinics.",
  },
  cotm: {
    1: "Value driver primer before certification. Small gap to close.",
    2: "EMD talk track and certification path. Exists today.",
    3: "Message reassembly for unfamiliar personas. Yoodli role play.",
  },
  techai: {
    1: "General AI literacy. What a model is, what an agent is. Net new.",
    2: "AI in the lifecycle and the downstream pressure of generated code.",
    3: "Agentic workflows, governance, evaluating vendor claims.",
  },
  pipegen: {
    1: "Tooling and activity expectations. Closest existing tier.",
    2: "Territory planning, triggers, outbound quality. Net new for AEs.",
    3: "Conversion analysis and coaching others. Net new.",
  },
  compete: {
    1: "Category map and who threatens what. From existing battlecards.",
    2: "Win themes and standard objections. Battlecards turned into modules.",
    3: "Homegrown displacement and loss pattern recognition. Deal clinics.",
  },
};
