/**
 * The hands-on experiences whose runs are kept, and what a finished run may
 * report. Pure, so the route that records a run, the experiences that report
 * one and the reporting page all read the same list. The Developer experience
 * is kept as finished or not; the Enterprise Security Team as its attempts
 * and best total; the slide review, which never ends, as each slide finished.
 *
 * A slide is reported as its seed, how many of its mistakes were found and
 * how many wrong clicks there were; the slide and its score are worked out
 * again here from the seed, so a browser can't claim more mistakes than the
 * slide had.
 */

import { MAX_SCORE as SECURITY_MAX } from "@/lib/mimir/security-game/scenario";
import { generateSlide, isSeed } from "@/lib/mimir/slide-review/generate";
import { pointsFor } from "@/lib/mimir/slide-review/slides";

export const EXPERIENCE_IDS = ["developer", "security", "slide-review"] as const;
export type ExperienceId = (typeof EXPERIENCE_IDS)[number];

export const EXPERIENCE_NAMES: Record<ExperienceId, string> = {
  developer: "Day in the Life: Developer",
  security: "Day in the Life: Enterprise Security Team",
  "slide-review": "Review the “Our understanding” slide",
};

export const isExperienceId = (v: unknown): v is ExperienceId => EXPERIENCE_IDS.includes(v as ExperienceId);

/** How many of a person's latest slides the report carries with their row. */
export const RECENT_SLIDES = 20;

/** More wrong clicks than this on one slide is not a run anyone played. */
export const WRONG_CLICKS_MAX = 1000;

export type ExperienceRun =
  | { experience: "developer"; score: null }
  | { experience: "security"; score: number }
  | {
      experience: "slide-review";
      seed: number;
      theme: string;
      found: number;
      total: number;
      wrongClicks: number;
      score: number;
    };

const isCount = (n: unknown, max: number): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= max;

/** A run as the browser sent it, checked against what that experience can report; null when it can't be one. */
export function parseExperienceRun(body: unknown): ExperienceRun | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;

  switch (b.experience) {
    case "developer":
      return b.score === undefined || b.score === null ? { experience: "developer", score: null } : null;
    case "security":
      return isCount(b.score, SECURITY_MAX) ? { experience: "security", score: b.score } : null;
    case "slide-review": {
      if (!isSeed(b.seed)) return null;
      const slide = generateSlide(b.seed);
      const total = slide.flaws.length;
      if (!isCount(b.found, total) || !isCount(b.wrongClicks, WRONG_CLICKS_MAX)) return null;
      const score = pointsFor({ found: b.found, wrongClicks: b.wrongClicks, missed: total - b.found });
      return { experience: "slide-review", seed: b.seed, theme: slide.theme, found: b.found, total, wrongClicks: b.wrongClicks, score };
    }
    default:
      return null;
  }
}
