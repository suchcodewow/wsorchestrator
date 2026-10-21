/**
 * Where each employee normally is, as an IANA time zone. It is kept in
 * `employee_timezones`, which outlives the HiBob sync that rewrites
 * `employees`, and copied onto `employees.timezone` by it:
 *
 * - The sync gives anyone under the Organization Leader who has none the one
 *   Slack has for them (`slackTimezones`), once; it never replaces one
 *   already kept.
 * - Their answer to the Pre-Bootcamp form's time zone question replaces
 *   whatever is kept (`setTimezone`).
 */

import "server-only";

import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { employeeTimezones, employees } from "@/db/schema";
import { slackClient, SlackError, SlackOutOfTime, slackToken } from "@/lib/slack";
import { isTimeZone } from "@/lib/timezones";

const SLACK_BUDGET_MS = 60_000;

/** Each person's zone kept so far, by lowercased email. */
export async function keptTimezones(): Promise<Map<string, string>> {
  const rows = await db.select({ email: employeeTimezones.email, timezone: employeeTimezones.timezone }).from(employeeTimezones);
  return new Map(rows.map((r) => [r.email, r.timezone]));
}

/** The zone the app has for `email` now; null for someone it has none for. */
export async function timezoneOnRecord(email: string): Promise<string | null> {
  const [row] = await db
    .select({ timezone: employeeTimezones.timezone })
    .from(employeeTimezones)
    .where(eq(employeeTimezones.email, email.toLowerCase()));
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
 * Writes Slack's zones for people with none kept, inside the sync's
 * transaction. One kept meanwhile, such as an answer to the form, stays.
 */
export async function keepSlackTimezones(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  fromSlack: Map<string, string>,
): Promise<void> {
  const rows = [...fromSlack].map(([email, timezone]) => ({ email, timezone, source: "slack" as const }));
  for (let i = 0; i < rows.length; i += 500) {
    await tx.insert(employeeTimezones).values(rows.slice(i, i + 500)).onConflictDoNothing();
  }
}

/**
 * Makes `timezone` the one the app has for `email`. Returns whether they are
 * an employee; nothing is kept for an email no employee has.
 */
export async function setTimezone(email: string, timezone: string, actorId: string | null): Promise<boolean> {
  const address = email.toLowerCase();
  return db.transaction(async (tx) => {
    // The HiBob sync's lock: it rewrites `employees`, and reads these, under it.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('hibob_employees'))`);
    const updated = await tx
      .update(employees)
      .set({ timezone })
      .where(sql`lower(${employees.email}) = ${address}`)
      .returning({ id: employees.id });
    if (updated.length === 0) return false;
    await tx
      .insert(employeeTimezones)
      .values({ email: address, timezone, source: "intake", updatedBy: actorId })
      .onConflictDoUpdate({
        target: employeeTimezones.email,
        set: { timezone, source: "intake", updatedBy: actorId, updatedAt: new Date() },
      });
    return true;
  });
}
