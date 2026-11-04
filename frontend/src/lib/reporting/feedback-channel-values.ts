/**
 * The name of the private Slack channel a Live Sessions person is discussed
 * in, kept apart from `feedback-channels.ts` so it can be tested without a
 * database.
 */

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
