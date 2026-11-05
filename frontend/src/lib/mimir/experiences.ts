/**
 * The hands-on experiences whose runs are kept, and what a finished run may
 * report. Pure, so the route that records a run, the experiences that report
 * one and the reporting page all read the same list. The Developer experience
 * is kept as finished or not; the Enterprise Security Team as its best total
 * of a run; the slide review a slide at a time, each with its best score.
 */

import { MAX_SCORE as SECURITY_MAX } from "@/lib/mimir/security-game/scenario";
import { SLIDES } from "@/lib/mimir/slide-review/slides";

export const EXPERIENCE_IDS = ["developer", "security", "slide-review"] as const;
export type ExperienceId = (typeof EXPERIENCE_IDS)[number];

export const EXPERIENCE_NAMES: Record<ExperienceId, string> = {
  developer: "Day in the Life: Developer",
  security: "Day in the Life: Enterprise Security Team",
  "slide-review": "Review the “Our understanding” slide",
};

export const isExperienceId = (v: unknown): v is ExperienceId => EXPERIENCE_IDS.includes(v as ExperienceId);

/**
 * The lowest score a slide can report. Wrong clicks have no limit in play, so
 * this only keeps a nonsense number out of the table.
 */
export const SLIDE_SCORE_FLOOR = -1000;

export type ExperienceRun = { experience: ExperienceId; part: string; score: number | null };

/** A run as the browser sent it, checked against what that experience can report; null when it can't be one. */
export function parseExperienceRun(body: unknown): ExperienceRun | null {
  if (!body || typeof body !== "object") return null;
  const { experience, part = "", score = null } = body as Record<string, unknown>;
  if (!isExperienceId(experience) || typeof part !== "string") return null;
  if (score !== null && !Number.isInteger(score)) return null;
  const n = score as number | null;

  switch (experience) {
    case "developer":
      return part === "" && n === null ? { experience, part, score: null } : null;
    case "security":
      return part === "" && n !== null && n >= 0 && n <= SECURITY_MAX ? { experience, part, score: n } : null;
    case "slide-review": {
      const slide = SLIDES.find((s) => s.id === part);
      return slide && n !== null && n >= SLIDE_SCORE_FLOOR && n <= slide.flaws.length ? { experience, part, score: n } : null;
    }
  }
}
