/**
 * Slash commands sent to the Slack app: proving a request is Slack's, and the
 * words `/val` answers with. `SLACK_SIGNING_SECRET` is the app's Signing
 * Secret (Basic Information on api.slack.com); unset, every command is refused.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { UpcomingBootcamp } from "@/lib/scheduler/bootcamps";

/** How far a request's timestamp may be from now, as Slack advises, so a captured one cannot be replayed later. */
const TOLERANCE_SECONDS = 300;

/** Whether `signature` is Slack's v0 signature of `body` sent at `timestamp` (seconds). */
export function slackSignatureValid(
  secret: string | undefined,
  body: string,
  timestamp: string | null,
  signature: string | null,
  now: Date = new Date(),
): boolean {
  if (!secret || !timestamp || !signature) return false;
  const sent = Number(timestamp);
  if (!Number.isInteger(sent) || Math.abs(now.getTime() / 1000 - sent) > TOLERANCE_SECONDS) return false;
  const expected = Buffer.from(`v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex")}`);
  const given = Buffer.from(signature);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** Two `YYYY-MM-DD` days as "Nov 9 – 12, 2026", or one as "Nov 9, 2026". */
function formatRange(start: string, end: string): string {
  const from = new Date(`${start}T00:00:00Z`);
  return start === end ? DAY.format(from) : DAY.formatRange(from, new Date(`${end}T00:00:00Z`));
}

/** The Welcome page's Upcoming Sessions as a Slack message. */
export function upcomingMessage(sessions: UpcomingBootcamp[]): string {
  if (sessions.length === 0) return "No sessions are scheduled.";
  const lines = sessions.map(
    (s) => `• *${formatRange(s.startDate, s.endDate)}*: ${s.intDays === null ? "Bootcamp" : "Bootcamp and Intermediate"}`,
  );
  return `*Upcoming Sessions*\n${lines.join("\n")}`;
}
