/**
 * The guest judges of one bootcamp: anyone from the employee list, set in
 * the Scheduler's bootcamp dialog by a Training administrator. While the bootcamp is active
 * they can score its attendees on the eVals page; see `judging.ts`.
 */

import "server-only";

import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { BOOTCAMP_LIMITS, EVALS_SLACK_CONTACT_LIMITS, bootcampJudges, bootcamps, employees, users } from "@/db/schema";
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

export type JudgePick = { email: string; fullName: string };

/**
 * The employees `emails` name, lowercased and each once, for a bootcamp's
 * whole set of judges; `not_employee` names the first one the employee list
 * does not have.
 */
export async function resolveJudges(
  emails: string[],
): Promise<{ ok: true; judges: JudgePick[] } | { ok: false; error: "invalid" | "not_employee"; email?: string }> {
  const normal = emails.map(normalEmail);
  if (normal.some((e) => e === null)) return { ok: false, error: "invalid" };
  const wanted = [...new Set(normal as string[])];
  if (wanted.length === 0) return { ok: true, judges: [] };

  const found = await db
    .select({ email: sql<string>`lower(${employees.email})`, fullName: employees.fullName })
    .from(employees)
    .where(inArray(sql`lower(${employees.email})`, wanted));
  const byEmail = new Map(found.map((e) => [e.email, e.fullName]));
  const missing = wanted.find((e) => !byEmail.has(e));
  if (missing) return { ok: false, error: "not_employee", email: missing };
  return { ok: true, judges: wanted.map((email) => ({ email, fullName: byEmail.get(email)! })) };
}

/**
 * Makes `judges` exactly the bootcamp's judges: anyone left out is removed,
 * anyone new is added, and anyone kept keeps when and by whom they were added.
 */
export async function setJudges(
  tx: Pick<typeof db, "delete" | "insert">,
  actorId: string,
  bootcampId: string,
  judges: JudgePick[],
): Promise<void> {
  const emails = judges.map((j) => j.email);
  await tx
    .delete(bootcampJudges)
    .where(
      and(
        eq(bootcampJudges.bootcampId, bootcampId),
        emails.length > 0 ? notInArray(bootcampJudges.email, emails) : undefined,
      ),
    );
  if (judges.length === 0) return;
  await tx
    .insert(bootcampJudges)
    .values(judges.map((j) => ({ bootcampId, email: j.email, fullName: j.fullName, addedBy: actorId })))
    .onConflictDoNothing();
}

/** A bootcamp's judges by name, as its dialog edits them. */
export async function judgePicks(bootcampId: string): Promise<JudgePick[]> {
  return db
    .select({ email: bootcampJudges.email, fullName: bootcampJudges.fullName })
    .from(bootcampJudges)
    .where(eq(bootcampJudges.bootcampId, bootcampId))
    .orderBy(sql`lower(coalesce(${blankAsNull(bootcampJudges.fullName)}, ${bootcampJudges.email}))`, bootcampJudges.email)
    .limit(BOOTCAMP_LIMITS.judges);
}

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
