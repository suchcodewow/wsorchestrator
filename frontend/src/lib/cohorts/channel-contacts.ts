/**
 * The Additional Channel Contacts: people added to the active bootcamp's
 * Slack channels beyond its cohort. Bootcamp Contacts join the `sales-`
 * channels, Engineer Contacts the `se-` ones; see `slack-plan.ts`.
 */

import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  CHANNEL_CONTACT_KINDS,
  CHANNEL_CONTACT_LIMITS,
  cohortChannelContacts,
  users,
  type ChannelContactKind,
} from "@/db/schema";
import { normalEmail } from "@/lib/evals/history-values";
import { employeeByEmail } from "@/lib/evals/roster";
import type { ChannelContactSort } from "@/lib/list-specs";
import { pageWindow, toPage, type ListQuery, type Page } from "@/lib/paging";
import { blankAsNull, orderFor, searchAny } from "@/lib/paging-sql";

export function isChannelContactKind(value: unknown): value is ChannelContactKind {
  return CHANNEL_CONTACT_KINDS.includes(value as ChannelContactKind);
}

export type ChannelContactRow = {
  id: string;
  kind: ChannelContactKind;
  email: string;
  fullName: string;
  createdAt: Date;
  addedBy: string | null;
};

const c = cohortChannelContacts;

const SORT_COLUMNS = {
  fullName: sql`lower(coalesce(${blankAsNull(c.fullName)}, ${c.email}))`,
  email: c.email,
  addedBy: sql`lower(coalesce(nullif(${users.name}, ''), ${users.email}))`,
  createdAt: c.createdAt,
} as const;

/** One page of one kind's contacts; the search matches the name, the email or who added them. */
export async function listChannelContacts(
  kind: ChannelContactKind,
  query: ListQuery<ChannelContactSort>,
): Promise<Page<ChannelContactRow>> {
  const { limit, offset } = pageWindow(query.page);
  const rows = await db
    .select({
      id: c.id,
      kind: c.kind,
      email: c.email,
      fullName: c.fullName,
      createdAt: c.createdAt,
      addedByName: users.name,
      addedByEmail: users.email,
    })
    .from(c)
    .leftJoin(users, eq(users.id, c.createdBy))
    .where(and(eq(c.kind, kind), searchAny(query.q, [c.fullName, c.email, users.name, users.email])))
    .orderBy(...orderFor(SORT_COLUMNS[query.sort], query.dir, c.email, c.id))
    .limit(limit)
    .offset(offset);

  return toPage(
    rows.map(({ addedByName, addedByEmail, ...row }) => ({ ...row, addedBy: addedByName ?? addedByEmail })),
    query.page,
  );
}

/** How many contacts each kind has in all. */
export async function channelContactCounts(): Promise<Record<ChannelContactKind, number>> {
  const rows = await db
    .select({ kind: c.kind, count: sql<number>`count(*)::int` })
    .from(c)
    .groupBy(c.kind);
  const counts: Record<ChannelContactKind, number> = { sales: 0, se: 0 };
  for (const r of rows) counts[r.kind] = r.count;
  return counts;
}

/** Every contact's email and kind, for the sync, which adds them all. */
export async function allChannelContacts(): Promise<{ email: string; kind: ChannelContactKind }[]> {
  return db.select({ email: c.email, kind: c.kind }).from(c);
}

export type ChannelContactError = "invalid" | "duplicate" | "not_found";

export const STATUS_FOR: Record<ChannelContactError, number> = {
  invalid: 400,
  duplicate: 409,
  not_found: 404,
};

export const addChannelContactSchema = z.object({
  kind: z.enum(CHANNEL_CONTACT_KINDS),
  email: z.string().max(CHANNEL_CONTACT_LIMITS.email),
});

/**
 * Adds one contact by email, named as the employee list has them. Someone not
 * in that list can still be added; they are listed by email alone.
 */
export async function addChannelContact(
  actorId: string,
  input: z.infer<typeof addChannelContactSchema>,
): Promise<
  | { ok: true; contact: { id: string; kind: ChannelContactKind; email: string; fullName: string } }
  | { ok: false; error: ChannelContactError }
> {
  const email = normalEmail(input.email);
  if (!email) return { ok: false, error: "invalid" };

  const employee = await employeeByEmail(email);
  const [row] = await db
    .insert(c)
    .values({ kind: input.kind, email, fullName: employee?.fullName ?? "", createdBy: actorId })
    .onConflictDoNothing()
    .returning({ id: c.id, kind: c.kind, email: c.email, fullName: c.fullName });
  return row ? { ok: true, contact: row } : { ok: false, error: "duplicate" };
}

export async function deleteChannelContact(
  id: string,
): Promise<{ ok: true; email: string; kind: ChannelContactKind } | { ok: false; error: ChannelContactError }> {
  const [deleted] = await db.delete(c).where(eq(c.id, id)).returning({ email: c.email, kind: c.kind });
  return deleted ? { ok: true, ...deleted } : { ok: false, error: "not_found" };
}
