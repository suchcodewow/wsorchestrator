/**
 * The Additional Slack Contacts: people added to the Slack messages sent to
 * each attendee's team at the end of a bootcamp, after the attendee's
 * management chain. Kept apart from `employees.management_chain`, which the
 * HiBob sync rewrites.
 */

import "server-only";

import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { EVALS_SLACK_CONTACT_LIMITS, evalsSlackContacts, users } from "@/db/schema";
import { normalEmail } from "@/lib/evals/history-values";
import { employeeByEmail } from "@/lib/evals/roster";
import type { SlackContactSort } from "@/lib/list-specs";
import { pageWindow, toPage, type ListQuery, type Page } from "@/lib/paging";
import { blankAsNull, orderFor, searchAny } from "@/lib/paging-sql";

export type SlackContactRow = {
  id: string;
  email: string;
  fullName: string;
  createdAt: Date;
  addedBy: string | null;
};

const SLACK_CONTACT_SORT_COLUMNS = {
  fullName: sql`lower(coalesce(${blankAsNull(evalsSlackContacts.fullName)}, ${evalsSlackContacts.email}))`,
  email: evalsSlackContacts.email,
  addedBy: sql`lower(coalesce(nullif(${users.name}, ''), ${users.email}))`,
  createdAt: evalsSlackContacts.createdAt,
} as const;

/** One page of contacts; the search matches the name, the email or who added them. */
export async function listSlackContacts(query: ListQuery<SlackContactSort>): Promise<Page<SlackContactRow>> {
  const { limit, offset } = pageWindow(query.page);
  const rows = await db
    .select({
      id: evalsSlackContacts.id,
      email: evalsSlackContacts.email,
      fullName: evalsSlackContacts.fullName,
      createdAt: evalsSlackContacts.createdAt,
      addedByName: users.name,
      addedByEmail: users.email,
    })
    .from(evalsSlackContacts)
    .leftJoin(users, eq(users.id, evalsSlackContacts.createdBy))
    .where(
      searchAny(query.q, [evalsSlackContacts.fullName, evalsSlackContacts.email, users.name, users.email]),
    )
    .orderBy(
      ...orderFor(SLACK_CONTACT_SORT_COLUMNS[query.sort], query.dir, evalsSlackContacts.email, evalsSlackContacts.id),
    )
    .limit(limit)
    .offset(offset);

  return toPage(
    rows.map(({ addedByName, addedByEmail, ...row }) => ({ ...row, addedBy: addedByName ?? addedByEmail })),
    query.page,
  );
}

/** How many contacts there are in all. */
export async function slackContactCount(): Promise<number> {
  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(evalsSlackContacts);
  return row?.count ?? 0;
}

export type SlackContactError = "invalid" | "duplicate" | "not_found";

export const STATUS_FOR: Record<SlackContactError, number> = {
  invalid: 400,
  duplicate: 409,
  not_found: 404,
};

export const addSlackContactSchema = z.object({
  email: z.string().max(EVALS_SLACK_CONTACT_LIMITS.email),
});

/**
 * Adds one contact by email, named as the employee list has them. Someone not
 * in that list can still be added; they are listed by email alone.
 */
export async function addSlackContact(
  actorId: string,
  input: z.infer<typeof addSlackContactSchema>,
): Promise<{ ok: true; contact: { id: string; email: string; fullName: string } } | { ok: false; error: SlackContactError }> {
  const email = normalEmail(input.email);
  if (!email) return { ok: false, error: "invalid" };

  const employee = await employeeByEmail(email);
  const [row] = await db
    .insert(evalsSlackContacts)
    .values({ email, fullName: employee?.fullName ?? "", createdBy: actorId })
    .onConflictDoNothing()
    .returning({ id: evalsSlackContacts.id, email: evalsSlackContacts.email, fullName: evalsSlackContacts.fullName });
  return row ? { ok: true, contact: row } : { ok: false, error: "duplicate" };
}

export async function deleteSlackContact(
  id: string,
): Promise<{ ok: true; email: string } | { ok: false; error: SlackContactError }> {
  const [deleted] = await db
    .delete(evalsSlackContacts)
    .where(eq(evalsSlackContacts.id, id))
    .returning({ email: evalsSlackContacts.email });
  return deleted ? { ok: true, email: deleted.email } : { ok: false, error: "not_found" };
}
