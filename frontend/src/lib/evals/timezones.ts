/**
 * Where each employee normally is, as an IANA time zone, in
 * `employees.timezone`:
 *
 * - The HiBob sync gives anyone under the Organization Leader who has none
 *   the one Slack has for them (`slackTimezones`); it never replaces one
 *   already there.
 * - Their answer to the Pre-Bootcamp form's time zone question replaces
 *   whatever is there (`setTimezone`).
 */

import "server-only";

import { isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { employees } from "@/db/schema";
import { slackClient, SlackError, SlackOutOfTime, slackToken } from "@/lib/slack";
import { isTimeZone } from "@/lib/timezones";

const SLACK_BUDGET_MS = 60_000;

/** Everyone who has a time zone already, by lowercased email. */
export async function emailsWithTimezone(): Promise<Set<string>> {
  const rows = await db.select({ email: employees.email }).from(employees).where(isNotNull(employees.timezone));
  return new Set(rows.map((r) => r.email));
}

/** The zone the app has for `email` now; null for someone it has none for. */
export async function timezoneOnRecord(email: string): Promise<string | null> {
  const [row] = await db
    .select({ timezone: employees.timezone })
    .from(employees)
    .where(sql`lower(${employees.email}) = ${email.toLowerCase()}`)
    .limit(1);
  return row?.timezone ?? null;
}

type SlackListed = {
  members: { deleted?: boolean; is_bot?: boolean; tz?: string; profile?: { email?: string } }[];
  response_metadata?: { next_cursor?: string };
};

/**
 * The zone Slack has for each of `emails`, lowercased, among the workspace's
 * active people — from one pass over `users.list`, not a lookup apiece. An
 * empty map when Slack is not connected, cannot be read in time, or answers
 * with an error: the sync goes on without, and asks again next time.
 */
export async function slackTimezones(emails: Set<string>): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  if (emails.size === 0) return found;
  const token = await slackToken();
  if (!token) return found;
  const slack = slackClient(token, Date.now() + SLACK_BUDGET_MS);
  try {
    let cursor = "";
    do {
      const page = await slack.call<SlackListed>("users.list", { limit: "1000", ...(cursor ? { cursor } : {}) });
      for (const m of page.members) {
        const email = m.profile?.email?.toLowerCase();
        if (m.deleted || m.is_bot || !email || !emails.has(email) || !isTimeZone(m.tz)) continue;
        found.set(email, m.tz);
      }
      cursor = page.response_metadata?.next_cursor ?? "";
    } while (cursor);
  } catch (err) {
    if (!(err instanceof SlackError || err instanceof SlackOutOfTime)) throw err;
    console.warn(`HiBob sync: Slack time zones skipped — ${err.message}`);
  }
  return found;
}

/**
 * Makes `timezone` the one the app has for `email`. Returns whether they are
 * an employee.
 */
export async function setTimezone(email: string, timezone: string): Promise<boolean> {
  const updated = await db
    .update(employees)
    .set({ timezone })
    .where(sql`lower(${employees.email}) = ${email.toLowerCase()}`)
    .returning({ id: employees.id });
  return updated.length > 0;
}
