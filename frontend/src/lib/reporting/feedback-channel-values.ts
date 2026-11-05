/**
 * The name of the private Slack channel a Live Sessions person is discussed
 * in, and the message the button posts there, kept apart from
 * `feedback-channels.ts` so they can be tested without a database.
 */

import { BOOTCAMP_SCORE } from "@/db/schema";
import { STAGE_LABELS } from "@/lib/evals/assessment-values";
import { roundScore } from "@/lib/evals/history-values";
import type { ClassSummary, ReleaseStage } from "@/lib/reporting/bootcamp-values";

/** Slack's longest channel name. */
const SLACK_NAME_MAX = 80;

const PREFIX = "event-feedback";

function slug(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * `event-feedback-{first}-{last}`, from the first and last words of their
 * name, or the part of their email before the `@` when they have none.
 * `n` above 1 adds `-{n}`, for a name another attendee's channel already has.
 */
export function feedbackChannelName(fullName: string | null, email: string, n = 1): string {
  const words = (fullName ?? "").split(/\s+/).map(slug).filter(Boolean);
  const who = words.length > 0 ? [words[0], ...(words.length > 1 ? [words[words.length - 1]] : [])].join("-") : slug(email.split("@")[0] ?? "") || "attendee";
  const suffix = n > 1 ? `-${n}` : "";
  return `${PREFIX}-${who}`.slice(0, SLACK_NAME_MAX - suffix.length).replace(/-+$/, "") + suffix;
}

/** Slack's mrkdwn treats these three as markup. */
const slackEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A score as Live Sessions shows it: a whole number, from its one-decimal value. */
const whole = (score: number) => Math.round(roundScore(score));

/**
 * The one message the button posts: who opened the channel and a link to the
 * card, then the class's scorecard as the card shows it. Its overall score,
 * overall feedback, average exam score, and each exercise that did not score
 * a 3, with its feedback. `scorecard` is the furthest class they have been
 * to; with none, the message is the first line alone.
 */
export function feedbackChannelText(
  who: string,
  about: string,
  cardUrl: string,
  scorecard: { stage: ReleaseStage; summary: ClassSummary } | null,
): string {
  const lines = [`${slackEscape(who)} opened this to discuss *${slackEscape(about)}*: <${cardUrl}|their Live Sessions card>`];
  if (!scorecard) return lines.join("\n");

  const { stage, summary } = scorecard;
  const overall = summary.score === null ? "—" : `${whole(summary.score)} / ${BOOTCAMP_SCORE.max}`;
  lines.push("", `*Overall Score (${STAGE_LABELS[stage]}):* ${overall}`);
  if (summary.positiveFeedback.trim()) lines.push(`*Overall Positive Feedback:* ${slackEscape(summary.positiveFeedback.trim())}`);
  if (summary.constructiveFeedback.trim()) {
    lines.push(`*Overall Constructive Feedback:* ${slackEscape(summary.constructiveFeedback.trim())}`);
  }
  if (summary.examAverage !== null) lines.push(`*Average Exam Score:* ${Math.round(summary.examAverage)}%`);

  const notable = summary.exercises.filter((e) => whole(e.score) !== 3);
  if (notable.length > 0) {
    lines.push("*Score Breakdown (scores of 3 are filtered out here):*");
    for (const e of notable) {
      const feedback = e.feedback?.trim() ? ` — ${slackEscape(e.feedback.trim())}` : "";
      lines.push(`• ${slackEscape(e.name)}: ${whole(e.score)}${feedback}`);
    }
  }
  return lines.join("\n");
}
