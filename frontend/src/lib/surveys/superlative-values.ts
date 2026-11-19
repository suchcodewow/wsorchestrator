/**
 * The Bootcamp superlatives survey's rules: the standing list's shape, who
 * someone can vote for, the checks on their votes, who leads each
 * superlative, and the Slack announcement. Pure, so the scheduler, the
 * survey at /intake, Survey Results, Logistics settings and the unit suite
 * share them with the routes.
 */

import { z } from "zod";
import { SUPERLATIVE_LIMITS, type Superlative, type SuperlativeNominee, type SuperlativeVotes } from "@/db/schema";
import type { CohortChannelKind } from "@/lib/cohorts/slack-plan";

/** The class's channel, `sales-bootcamp-<mon>-<yyyy>`, which holds its Engineers as well. */
export const SUPERLATIVES_CHANNEL_KIND: CohortChannelKind = "sales_bootcamp";

/** The standing list as Logistics settings saves it: a new superlative has no id until it is saved. */
export const superlativeListSchema = z
  .object({
    superlatives: z
      .array(
        z
          .object({
            id: z.string().min(1).max(64).optional(),
            title: z.string().trim().min(1).max(SUPERLATIVE_LIMITS.title),
          })
          .strict(),
      )
      .max(SUPERLATIVE_LIMITS.superlatives),
  })
  .strict();

export type SuperlativeListInput = z.infer<typeof superlativeListSchema>;

/**
 * The list to keep from `input`, each wording trimmed: each superlative's id
 * kept, or made with `newId` for one without; a repeated id is given a new
 * one, so no two share.
 */
export function superlativeListFrom(input: SuperlativeListInput, newId: () => string): Superlative[] {
  const seen = new Set<string>();
  return input.superlatives.map(({ id, title }) => {
    const kept = id && !seen.has(id) ? id : newId();
    seen.add(kept);
    return { id: kept, title: title.trim() };
  });
}

/** The classmates `voter` can vote for: everyone in the class but themselves, by name. */
export function ballotFor(nominees: readonly SuperlativeNominee[], voter: string): SuperlativeNominee[] {
  const me = voter.toLowerCase();
  return nominees
    .filter((n) => n.email.toLowerCase() !== me)
    .sort((a, b) => a.fullName.localeCompare(b.fullName) || a.email.localeCompare(b.email));
}

export const superlativeSubmissionSchema = z
  .object({ votes: z.record(z.string().max(64), z.string().trim().min(1).max(320)) })
  .strict();

export type SuperlativeSubmission = z.infer<typeof superlativeSubmissionSchema>;

/**
 * `required`: a superlative has no vote. `unknown_superlative`: a vote is for
 * one the survey does not ask. `not_a_nominee`: the classmate chosen is not
 * in the class. `self_vote`: they voted for themselves. Each names the
 * superlative by `superlativeId`.
 */
export type SuperlativeVoteProblem = {
  problem: "required" | "unknown_superlative" | "not_a_nominee" | "self_vote";
  superlativeId: string;
};

/** The votes to keep from `submission`, by `voter`, to a survey asking `superlatives` of `nominees`, or what is wrong with them. */
export function checkSuperlativeVotes(
  superlatives: readonly Pick<Superlative, "id">[],
  nominees: readonly Pick<SuperlativeNominee, "email">[],
  voter: string,
  submission: SuperlativeSubmission,
): { ok: true; votes: SuperlativeVotes } | { ok: false; error: SuperlativeVoteProblem } {
  const ids = new Set(superlatives.map((x) => x.id));
  const extra = Object.keys(submission.votes).find((id) => !ids.has(id));
  if (extra) return { ok: false, error: { problem: "unknown_superlative", superlativeId: extra } };
  const inClass = new Set(nominees.map((n) => n.email.toLowerCase()));
  const me = voter.toLowerCase();
  const votes: SuperlativeVotes = {};
  for (const { id } of superlatives) {
    const chosen = submission.votes[id]?.toLowerCase();
    if (!chosen) return { ok: false, error: { problem: "required", superlativeId: id } };
    if (chosen === me) return { ok: false, error: { problem: "self_vote", superlativeId: id } };
    if (!inClass.has(chosen)) return { ok: false, error: { problem: "not_a_nominee", superlativeId: id } };
    votes[id] = chosen;
  }
  return { ok: true, votes };
}

/**
 * The votes from `votes` still good on a survey now asking `superlatives` of
 * `nominees`, and whether every superlative still has one: what a survey
 * sent again keeps of an answer given before.
 */
export function keptVotes(
  votes: SuperlativeVotes,
  superlatives: readonly Pick<Superlative, "id">[],
  nominees: readonly Pick<SuperlativeNominee, "email">[],
): { votes: SuperlativeVotes; complete: boolean } {
  const inClass = new Set(nominees.map((n) => n.email.toLowerCase()));
  const kept: SuperlativeVotes = {};
  for (const { id } of superlatives) {
    const chosen = votes[id];
    if (chosen && inClass.has(chosen)) kept[id] = chosen;
  }
  return { votes: kept, complete: superlatives.every((x) => kept[x.id] !== undefined) };
}

/** One classmate's votes on one superlative. */
export type SuperlativeStanding = { email: string; fullName: string; votes: number };

/** The standings with the most votes, every one of them when there is a tie; none before anyone has voted. */
export function superlativeLeaders(standings: readonly SuperlativeStanding[]): SuperlativeStanding[] {
  const top = Math.max(0, ...standings.map((s) => s.votes));
  return top === 0 ? [] : standings.filter((s) => s.votes === top);
}

/** A Bootcamp's superlatives as its schedule shows them: whether they are out, and how many have voted. */
export type SuperlativeStatus = { assigned: number; answered: number };

/** The message that announces the superlatives in the class's channel, linking to /intake. */
export function superlativesAnnouncementText(link: string): string {
  return `:trophy: The *Bootcamp Superlatives* are out! Vote for a classmate for each one: <${link}|complete it here>.`;
}

/** "Bootcamp Superlatives", as /intake and Survey Results name the survey. */
export const SUPERLATIVES_TITLE = "Bootcamp Superlatives";
