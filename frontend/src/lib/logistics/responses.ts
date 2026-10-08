/**
 * Reading the intake form's responses back: every response, for Logistics
 * settings, and each attendee's dietary needs, for the Logistics page.
 */

import "server-only";

import { and, count, desc, sql } from "drizzle-orm";
import { db } from "@/db";
import { INTAKE_LIMITS, intakeResponses } from "@/db/schema";
import type { DietarySort, IntakeResponseSort } from "@/lib/list-specs";
import { DIETARY_QUESTION_IDS, type IntakeAnswers } from "@/lib/logistics/intake-values";
import { pageWindow, toPage, type ListQuery, type Page } from "@/lib/paging";
import { orderFor, searchAny } from "@/lib/paging-sql";

export type IntakeResponseRow = { id: string; email: string; answers: IntakeAnswers; submittedAt: string };

/** Only the responses whose answer to `question` is, or for checkboxes includes, `answer`. */
export type AnswerFilter = { question: string; answer: string };

/**
 * The answer filter a page's `searchParams` or a route's URL asks for, from
 * `question` and `answer`; null unless both are given.
 */
export function answerFilter(
  params: URLSearchParams | Record<string, string | string[] | undefined>,
): AnswerFilter | null {
  const read = (key: string) => {
    const v = params instanceof URLSearchParams ? params.get(key) : params[key];
    return (Array.isArray(v) ? v[0] : v)?.trim().slice(0, INTAKE_LIMITS.option) ?? "";
  };
  const question = read("question");
  const answer = read("answer");
  return question && answer ? { question, answer } : null;
}

const iso = <T extends { submittedAt: Date }>(row: T) => ({ ...row, submittedAt: row.submittedAt.toISOString() });

/** Every response, a page at a time, searched across the email and every answer. */
export async function listIntakeResponses(
  query: ListQuery<IntakeResponseSort>,
  filter: AnswerFilter | null,
): Promise<Page<IntakeResponseRow>> {
  const { limit, offset } = pageWindow(query.page);
  const sortColumn = { submittedAt: intakeResponses.submittedAt, email: intakeResponses.email }[query.sort];
  const rows = await db
    .select()
    .from(intakeResponses)
    .where(
      and(
        searchAny(query.q, [intakeResponses.email, sql`${intakeResponses.answers}::text`]),
        filter
          ? sql`${intakeResponses.answers} -> ${filter.question}::text @> to_jsonb(${filter.answer}::text)`
          : undefined,
      ),
    )
    .orderBy(...orderFor(sortColumn, query.dir, desc(intakeResponses.submittedAt), intakeResponses.id))
    .limit(limit)
    .offset(offset);
  return toPage(rows.map(iso), query.page);
}

/** Each attendee's most recent response: someone who sends the form twice is counted once. */
const latest = db
  .selectDistinctOn([intakeResponses.email], {
    email: intakeResponses.email,
    answers: intakeResponses.answers,
    submittedAt: intakeResponses.submittedAt,
  })
  .from(intakeResponses)
  .orderBy(intakeResponses.email, desc(intakeResponses.submittedAt))
  .as("latest");

/**
 * The answer to one of the dietary questions. Their ids are constants, written
 * into the SQL rather than bound, so that `critical` reads the same in a
 * GROUP BY as in the SELECT.
 */
const answer = (id: (typeof DIETARY_QUESTION_IDS)[keyof typeof DIETARY_QUESTION_IDS]) =>
  sql<string | null>`${latest.answers} ->> ${sql.raw(`'${id}'`)}`;

/** The first digit 1 to 5 in the answer, so "5", "5 - allergic" and "a 5" all read as 5. */
const critical = sql<number | null>`substring(${answer(DIETARY_QUESTION_IDS.critical)} from '[1-5]')::int`;
const hasNeeds = sql`${answer(DIETARY_QUESTION_IDS.has)} = 'Yes'`;

export type DietaryRow = {
  email: string;
  name: string | null;
  needs: string | null;
  critical: number | null;
  submittedAt: string;
};

/** Everyone who said they have dietary needs, a page at a time, the most critical first. */
export async function listDietaryNeeds(query: ListQuery<DietarySort>): Promise<Page<DietaryRow>> {
  const { limit, offset } = pageWindow(query.page);
  const name = answer(DIETARY_QUESTION_IDS.name);
  const needs = answer(DIETARY_QUESTION_IDS.needs);
  const sortColumn = {
    critical,
    name: sql`lower(nullif(${name}, ''))`,
    email: latest.email,
    submittedAt: latest.submittedAt,
  }[query.sort];
  const rows = await db
    .select({ email: latest.email, name, needs, critical, submittedAt: latest.submittedAt })
    .from(latest)
    .where(and(hasNeeds, searchAny(query.q, [latest.email, name, needs])))
    .orderBy(...orderFor(sortColumn, query.dir, sql`${critical} desc nulls last`, latest.email))
    .limit(limit)
    .offset(offset);
  return toPage(rows.map(iso), query.page);
}

export type DietaryCounts = {
  /** Attendees who have sent the form. */
  responded: number;
  /** Of them, those with dietary needs. */
  withNeeds: number;
  /** Those with needs at each level, 1 to 5; `unrated` gave no level that reads as one. */
  byLevel: Record<1 | 2 | 3 | 4 | 5, number>;
  unrated: number;
};

/** How many attendees have dietary needs at each level, whatever the search. */
export async function dietaryCounts(): Promise<DietaryCounts> {
  const [[totals], levels] = await Promise.all([
    db
      .select({ responded: count(), withNeeds: sql<number>`count(*) filter (where ${hasNeeds})::int` })
      .from(latest),
    db.select({ level: critical, n: count() }).from(latest).where(hasNeeds).groupBy(critical),
  ]);
  const byLevel = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let unrated = 0;
  for (const { level, n } of levels) {
    if (level && level >= 1 && level <= 5) byLevel[level as 1 | 2 | 3 | 4 | 5] = n;
    else unrated += n;
  }
  return { responded: totals?.responded ?? 0, withNeeds: totals?.withNeeds ?? 0, byLevel, unrated };
}
