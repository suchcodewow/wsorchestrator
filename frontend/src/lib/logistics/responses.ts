/**
 * Reading the intake forms' responses back: each person's latest answers to
 * one form, for Logistics settings, and each attendee's dietary needs from
 * both forms together, for the Logistics page: bootcamp and intermediate are
 * there at the same time, and are catered for as one group.
 */

import "server-only";

import { and, count, desc, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { INTAKE_LIMITS, employees, intakeResponses, type IntakeFormId } from "@/db/schema";
import { getTestGroup } from "@/lib/cohorts/test-group";
import { currentCohortSubquery } from "@/lib/evals/current-cohort";
import type { DietarySort, IntakeResponseSort, UnregisteredSort } from "@/lib/list-specs";
import { DIETARY_QUESTION_IDS, type IntakeAnswers } from "@/lib/logistics/intake-values";
import { pageWindow, toPage, type ListQuery, type Page } from "@/lib/paging";
import { orderFor, searchAny } from "@/lib/paging-sql";

export type IntakeResponseRow = {
  id: string;
  /** Which form it answers; with both listed, a person who answered both has a row for each. */
  form: IntakeFormId;
  email: string;
  /** Their name from HiBob; null for an email no employee has. */
  name: string | null;
  answers: IntakeAnswers;
  submittedAt: string;
};

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

/**
 * Each person's most recent response to `form`, or to either form when it is
 * null: someone who changes their answers is counted once, as they are now.
 * `perForm` keeps each person's latest to each form instead, for listing both.
 */
function latestOf(form: IntakeFormId | null, perForm = false) {
  return db
    .selectDistinctOn(perForm ? [intakeResponses.email, intakeResponses.form] : [intakeResponses.email], {
      id: intakeResponses.id,
      form: intakeResponses.form,
      email: intakeResponses.email,
      answers: intakeResponses.answers,
      submittedAt: intakeResponses.submittedAt,
    })
    .from(intakeResponses)
    .where(form ? eq(intakeResponses.form, form) : undefined)
    .orderBy(
      ...(perForm ? [intakeResponses.email, intakeResponses.form] : [intakeResponses.email]),
      desc(intakeResponses.submittedAt),
    )
    .as("latest");
}

/** One name per email from the employee list, so an email two employee rows share still lists once. */
function namedEmployees() {
  return db
    .selectDistinctOn([sql`lower(${employees.email})`], {
      email: sql<string>`lower(${employees.email})`.as("named_email"),
      fullName: employees.fullName,
    })
    .from(employees)
    .orderBy(sql`lower(${employees.email})`, employees.fullName)
    .as("named");
}

/**
 * Each person's latest answers to `form`, or with null their latest to each
 * form, both forms in one list; a page at a time, searched across their name,
 * email and every answer.
 */
export async function listIntakeResponses(
  form: IntakeFormId | null,
  query: ListQuery<IntakeResponseSort>,
  filter: AnswerFilter | null,
): Promise<Page<IntakeResponseRow>> {
  const { limit, offset } = pageWindow(query.page);
  const latest = form ? latestOf(form) : latestOf(null, true);
  const named = namedEmployees();
  const name = named.fullName;
  const sortColumn = { submittedAt: latest.submittedAt, name: sql`lower(${name})`, email: latest.email }[query.sort];
  const rows = await db
    .select({ id: latest.id, form: latest.form, email: latest.email, name, answers: latest.answers, submittedAt: latest.submittedAt })
    .from(latest)
    .leftJoin(named, eq(named.email, latest.email))
    .where(
      and(
        searchAny(query.q, [latest.email, name, sql`${latest.answers}::text`]),
        filter ? sql`${latest.answers} -> ${filter.question}::text @> to_jsonb(${filter.answer}::text)` : undefined,
      ),
    )
    .orderBy(...orderFor(sortColumn, query.dir, desc(latest.submittedAt), latest.id))
    .limit(limit)
    .offset(offset);
  return toPage(rows.map(iso), query.page);
}

/** Both forms' latest responses, one per person, which hold the dietary questions. */
const latest = latestOf(null);
const named = namedEmployees();

/**
 * Who the dietary list is for: the current cohort, bootcamp and intermediate,
 * and while the test group is on its members too. Answers from people in an
 * earlier cohort stay saved, so a returning intermediate's bootcamp answers
 * still count, but someone no longer in the cohort is not catered for.
 */
async function dietaryScope() {
  const [cohort, group] = await Promise.all([currentCohortSubquery(), getTestGroup()]);
  const testers = group.on ? group.members.map((m) => m.email) : [];
  return {
    cohort,
    inScope: or(isNotNull(cohort.email), testers.length ? inArray(latest.email, testers) : undefined),
  };
}

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
  /** The stage they are in now, bootcamp or intermediate; for a test group member, the form they answered. */
  stage: IntakeFormId;
  /** Which form the answer came from; a returning intermediate may not have answered theirs yet. */
  form: IntakeFormId;
  /** Whether they answered Yes to having dietary restrictions; everyone else is listed after them. */
  restricted: boolean;
  /** Their answer to the name question, or for a form that asks none the name the app has for them. */
  name: string | null;
  needs: string | null;
  critical: number | null;
  submittedAt: string;
};

/**
 * Everyone in the current cohort who has sent a form, a page at a time: those
 * who said they have dietary restrictions first, whatever the sort, the most
 * critical first by default; then everyone else, so the list is the whole
 * group to cater for.
 */
export async function listDietaryNeeds(query: ListQuery<DietarySort>): Promise<Page<DietaryRow>> {
  const { limit, offset } = pageWindow(query.page);
  const { cohort, inScope } = await dietaryScope();
  const name = sql<string | null>`coalesce(nullif(${answer(DIETARY_QUESTION_IDS.name)}, ''), ${named.fullName})`;
  const needs = answer(DIETARY_QUESTION_IDS.needs);
  const sortColumn = {
    critical,
    name: sql`lower(nullif(${name}, ''))`,
    email: latest.email,
    submittedAt: latest.submittedAt,
  }[query.sort];
  const rows = await db
    .select({
      email: latest.email,
      stage: sql<IntakeFormId>`coalesce(${cohort.stage}, ${latest.form})`,
      form: latest.form,
      name,
      needs,
      critical,
      restricted: sql<boolean>`coalesce(${hasNeeds}, false)`,
      submittedAt: latest.submittedAt,
    })
    .from(latest)
    .leftJoin(named, eq(named.email, latest.email))
    .leftJoin(cohort, eq(cohort.email, latest.email))
    .where(and(inScope, searchAny(query.q, [latest.email, name, needs])))
    .orderBy(
      sql`coalesce(${hasNeeds}, false) desc`,
      ...orderFor(sortColumn, query.dir, sql`${critical} desc nulls last`, latest.email),
    )
    .limit(limit)
    .offset(offset);
  return toPage(rows.map(iso), query.page);
}

export type DietaryCounts = {
  /** People in the current cohort who have sent either form. */
  responded: number;
  /** Of them, how many are at each stage now: the whole group to cater for, split. */
  respondedByStage: Record<IntakeFormId, number>;
  /** Everyone in the current cohort, registered or not. */
  cohortSize: number;
  /** Of them, those who have sent neither form: `listUnregistered`'s people. */
  notRegistered: number;
  /** Of them, those with dietary needs. */
  withNeeds: number;
  /** Those with needs at each level, 1 to 5; `unrated` gave no level that reads as one. */
  byLevel: Record<1 | 2 | 3 | 4 | 5, number>;
  unrated: number;
};

/** How many in the current cohort have dietary needs at each level, whatever the search. */
export async function dietaryCounts(): Promise<DietaryCounts> {
  const { cohort, inScope } = await dietaryScope();
  const stage = sql`coalesce(${cohort.stage}, ${latest.form})`;
  const [[totals], levels, [size]] = await Promise.all([
    db
      .select({
        responded: count(),
        withNeeds: sql<number>`count(*) filter (where ${hasNeeds})::int`,
        bootcamp: sql<number>`count(*) filter (where ${stage} = 'bootcamp')::int`,
        intermediate: sql<number>`count(*) filter (where ${stage} = 'intermediate')::int`,
      })
      .from(latest)
      .leftJoin(cohort, eq(cohort.email, latest.email))
      .where(inScope),
    db
      .select({ level: critical, n: count() })
      .from(latest)
      .leftJoin(cohort, eq(cohort.email, latest.email))
      .where(and(inScope, hasNeeds))
      .groupBy(critical),
    db
      .select({
        n: count(),
        notRegistered: sql<number>`count(*) filter (where not exists (select 1 from intake_responses r where r.email = ${cohort.email}))::int`,
      })
      .from(cohort),
  ]);
  const byLevel = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let unrated = 0;
  for (const { level, n } of levels) {
    if (level && level >= 1 && level <= 5) byLevel[level as 1 | 2 | 3 | 4 | 5] = n;
    else unrated += n;
  }
  return {
    responded: totals?.responded ?? 0,
    respondedByStage: { bootcamp: totals?.bootcamp ?? 0, intermediate: totals?.intermediate ?? 0 },
    cohortSize: size?.n ?? 0,
    notRegistered: size?.notRegistered ?? 0,
    withNeeds: totals?.withNeeds ?? 0,
    byLevel,
    unrated,
  };
}

export type UnregisteredRow = { email: string; name: string | null; stage: IntakeFormId };

/**
 * Everyone in the current cohort who has sent neither form yet, a page at a
 * time, so the Dietary needs page names who is still to register. Someone at
 * intermediate who registered for bootcamp a cohort ago has answers, so is
 * not here: their bootcamp needs are counted until they answer again.
 */
export async function listUnregistered(query: ListQuery<UnregisteredSort>): Promise<Page<UnregisteredRow>> {
  const { limit, offset } = pageWindow(query.page);
  const cohort = await currentCohortSubquery();
  const named = namedEmployees();
  const email = sql`${cohort.email}`;
  const sortColumn = { name: sql`lower(${named.fullName})`, email, stage: sql`${cohort.stage}` }[query.sort];
  const rows = await db
    .select({ email: cohort.email, name: named.fullName, stage: sql<IntakeFormId>`${cohort.stage}` })
    .from(cohort)
    .leftJoin(named, eq(named.email, cohort.email))
    .where(
      and(
        sql`not exists (select 1 from intake_responses r where r.email = ${cohort.email})`,
        searchAny(query.q, [email, named.fullName]),
      ),
    )
    .orderBy(...orderFor(sortColumn, query.dir, sql`lower(${named.fullName})`, email))
    .limit(limit)
    .offset(offset);
  return toPage(rows, query.page);
}
