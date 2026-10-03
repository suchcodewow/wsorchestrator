/**
 * The guest judges of one bootcamp: anyone from the employee list, added in
 * the Scheduler by a Training administrator. While the bootcamp is active
 * they can score its attendees on the eVals page; see `judging.ts`.
 */

import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { EVALS_SLACK_CONTACT_LIMITS, bootcampJudges, bootcamps, users } from "@/db/schema";
import { normalEmail } from "@/lib/evals/history-values";
import { employeeByEmail } from "@/lib/evals/roster";
import type { JudgeSort } from "@/lib/list-specs";
import { pageWindow, toPage, type ListQuery, type Page } from "@/lib/paging";
import { blankAsNull, orderFor, searchAny } from "@/lib/paging-sql";

export type JudgeRow = {
  id: string;
  email: string;
  fullName: string;
  addedAt: Date;
  addedBy: string | null;
};

const SORT_COLUMNS = {
  fullName: sql`lower(coalesce(${blankAsNull(bootcampJudges.fullName)}, ${bootcampJudges.email}))`,
  email: bootcampJudges.email,
  addedBy: sql`lower(coalesce(nullif(${users.name}, ''), ${users.email}))`,
  addedAt: bootcampJudges.addedAt,
} as const;

/** One page of a bootcamp's judges; the search matches the name, the email or who added them. */
export async function listJudges(bootcampId: string, query: ListQuery<JudgeSort>): Promise<Page<JudgeRow>> {
  const { limit, offset } = pageWindow(query.page);
  const rows = await db
    .select({
      id: bootcampJudges.id,
      email: bootcampJudges.email,
      fullName: bootcampJudges.fullName,
      addedAt: bootcampJudges.addedAt,
      addedByName: users.name,
      addedByEmail: users.email,
    })
    .from(bootcampJudges)
    .leftJoin(users, eq(users.id, bootcampJudges.addedBy))
    .where(
      and(
        eq(bootcampJudges.bootcampId, bootcampId),
        searchAny(query.q, [bootcampJudges.fullName, bootcampJudges.email, users.name, users.email]),
      ),
    )
    .orderBy(...orderFor(SORT_COLUMNS[query.sort], query.dir, bootcampJudges.email, bootcampJudges.id))
    .limit(limit)
    .offset(offset);

  return toPage(
    rows.map(({ addedByName, addedByEmail, ...row }) => ({ ...row, addedBy: addedByName ?? addedByEmail })),
    query.page,
  );
}

/** How many judges a bootcamp has in all. */
export async function judgeCount(bootcampId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(bootcampJudges)
    .where(eq(bootcampJudges.bootcampId, bootcampId));
  return row?.count ?? 0;
}

export type JudgeError = "invalid" | "not_employee" | "duplicate" | "not_found";

export const JUDGE_STATUS_FOR: Record<JudgeError, number> = {
  invalid: 400,
  not_employee: 400,
  duplicate: 409,
  not_found: 404,
};

export const addJudgeSchema = z.object({
  email: z.string().max(EVALS_SLACK_CONTACT_LIMITS.email),
});

/** Adds one employee, by email, as a judge on the bootcamp. */
export async function addJudge(
  actorId: string,
  bootcampId: string,
  input: z.infer<typeof addJudgeSchema>,
): Promise<{ ok: true; judge: { id: string; email: string; fullName: string } } | { ok: false; error: JudgeError }> {
  const email = normalEmail(input.email);
  if (!email) return { ok: false, error: "invalid" };

  const [bootcamp] = await db.select({ id: bootcamps.id }).from(bootcamps).where(eq(bootcamps.id, bootcampId));
  if (!bootcamp) return { ok: false, error: "not_found" };

  const employee = await employeeByEmail(email);
  if (!employee) return { ok: false, error: "not_employee" };

  const [row] = await db
    .insert(bootcampJudges)
    .values({ bootcampId, email, fullName: employee.fullName, addedBy: actorId })
    .onConflictDoNothing()
    .returning({ id: bootcampJudges.id, email: bootcampJudges.email, fullName: bootcampJudges.fullName });
  return row ? { ok: true, judge: row } : { ok: false, error: "duplicate" };
}

export async function removeJudge(
  bootcampId: string,
  judgeId: string,
): Promise<{ ok: true; email: string } | { ok: false; error: JudgeError }> {
  const [deleted] = await db
    .delete(bootcampJudges)
    .where(and(eq(bootcampJudges.id, judgeId), eq(bootcampJudges.bootcampId, bootcampId)))
    .returning({ email: bootcampJudges.email });
  return deleted ? { ok: true, email: deleted.email } : { ok: false, error: "not_found" };
}
