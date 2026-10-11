/**
 * The little of Slack's mrkdwn the app's messages use, read back for showing
 * a message as Slack would: `*bold*`, `<url|label>` links, and the `&amp;`,
 * `&lt;` and `&gt;` escapes. Anything else is plain text. Pure, so the run
 * log and the unit suite share it.
 */

export type SlackTextPart =
  | { kind: "text"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "link"; text: string; href: string };

const unescape = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** `<https://…|label>`, `<https://…>`, or `*bold*` with no space just inside either star. */
const TOKEN = /<(https?:\/\/[^|>\s]+)(?:\|([^>]*))?>|\*(\S(?:[^*]*\S)?)\*/g;

export function slackTextParts(text: string): SlackTextPart[] {
  const parts: SlackTextPart[] = [];
  let at = 0;
  for (const m of text.matchAll(TOKEN)) {
    if (m.index > at) parts.push({ kind: "text", text: unescape(text.slice(at, m.index)) });
    if (m[1]) parts.push({ kind: "link", href: m[1], text: unescape(m[2] ?? m[1]) });
    else parts.push({ kind: "bold", text: unescape(m[3]!) });
    at = m.index + m[0].length;
  }
  if (at < text.length) parts.push({ kind: "text", text: unescape(text.slice(at)) });
  return parts;
}
