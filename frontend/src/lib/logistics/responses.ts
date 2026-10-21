/**
 * Reading the intake forms' responses back: each person's latest answers to
 * one form, for Logistics settings, and the attendees' dietary needs from
 * both forms together, for the Logistics page: bootcamp and intermediate are
 * there at the same time, and are catered for as one group.
 */

import "server-only";

import { and, count, desc, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  INTAKE_LIMITS,
  employees,
  intakeResponses,
  type IntakeFormId,
} from "@/db/schema";
import { getTestGroup } from "@/lib/cohorts/test-group";
import { currentCohortSubquery } from "@/lib/evals/current-cohort";
import type {
  DietaryStage,
  IntakeResponseSort,
  UnregisteredSort,
  WriteInSort,
} from "@/lib/list-specs";
import {
  DIETARY_ITEMS,
  DIETARY_KEYS,
  DIETARY_OTHER,
  type IntakeAnswers,
} from "@/lib/logistics/intake-values";
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
    return (
      (Array.isArray(v) ? v[0] : v)?.trim().slice(0, INTAKE_LIMITS.option) ?? ""
    );
  };
  const question = read("question");
  const answer = read("answer");
  return question && answer ? { question, answer } : null;
}

const iso = <T extends { submittedAt: Date }>(row: T) => ({
  ...row,
  submittedAt: row.submittedAt.toISOString(),
});

/**
 * Each person's most recent response to `form`, or to either form when it is
 * null: someone who changes their answers is counted once, as they are now.
 * `perForm` keeps each person's latest to each form instead, for listing both.
 */
function latestOf(form: IntakeFormId | null, perForm = false) {
  return db
    .selectDistinctOn(
      perForm
        ? [intakeResponses.email, intakeResponses.form]
        : [intakeResponses.email],
      {
        id: intakeResponses.id,
        form: intakeResponses.form,
        email: intakeResponses.email,
        answers: intakeResponses.answers,
        submittedAt: intakeResponses.submittedAt,
      },
    )
    .from(intakeResponses)
    .where(form ? eq(intakeResponses.form, form) : undefined)
    .orderBy(
      ...(perForm
        ? [intakeResponses.email, intakeResponses.form]
        : [intakeResponses.email]),
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
  const sortColumn = {
    submittedAt: latest.submittedAt,
    name: sql`lower(${name})`,
    email: latest.email,
  }[query.sort];
  const rows = await db
    .select({
      id: latest.id,
      form: latest.form,
      email: latest.email,
      name,
      answers: latest.answers,
      submittedAt: latest.submittedAt,
    })
    .from(latest)
    .leftJoin(named, eq(named.email, latest.email))
    .where(
      and(
        searchAny(query.q, [latest.email, name, sql`${latest.answers}::text`]),
        filter
          ? sql`${latest.answers} -> ${filter.question}::text @> to_jsonb(${filter.answer}::text)`
          : undefined,
      ),
    )
    .orderBy(
      ...orderFor(sortColumn, query.dir, desc(latest.submittedAt), latest.id),
    )
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
  const [cohort, group] = await Promise.all([
    currentCohortSubquery(),
    getTestGroup(),
  ]);
  const testers = group.on ? group.members.map((m) => m.email) : [];
  return {
    cohort,
    inScope: or(
      isNotNull(cohort.email),
      testers.length ? inArray(latest.email, testers) : undefined,
    ),
  };
}

/** The answer under `key` as a JSON array, or an empty one for a person who has none or an answer that is not a list. */
const listAnswer = (key: string) =>
  sql`(case when jsonb_typeof(${latest.answers} -> ${sql.raw(`'${key}'`)}) = 'array' then ${latest.answers} -> ${sql.raw(`'${key}'`)} else '[]'::jsonb end)`;

/** `stageOf`, narrowed to the one stage asked for; nothing to narrow for everyone. */
const inStage = (stageOf: ReturnType<typeof sql>, stage: DietaryStage) =>
  stage === "all" ? undefined : sql`${stageOf} = ${stage}`;

/** The stage someone is in now, or for a test group member the form they answered. */
const stageOfLatest = (cohortStage: ReturnType<typeof sql>) =>
  sql`coalesce(${cohortStage}, ${latest.form})`;

export type DietaryItemCount = { item: string; count: number };

export type DietaryCounts = {
  /** People in the current cohort, at the stage asked for, who have sent either form. */
  responded: number;
  /** Of them, how many checked anything on the dietary checklist. */
  withNeeds: number;
  /** Of them, how many marked anything Critical. */
  withCritical: number;
  /** Everyone in the current cohort at that stage, registered or not. */
  cohortSize: number;
  /** Of them, those who have sent neither form: `listUnregistered`'s people. */
  notRegistered: number;
  /** Each item someone marked Critical, with how many did; the most first. */
  critical: DietaryItemCount[];
  /** Each item someone checked without marking it Critical, with how many did; the most first. */
  notCritical: DietaryItemCount[];
};

/** How many people have each item in `key`'s answer, for those in the current cohort at `stage`. */
async function itemCounts(
  key: string,
  stage: DietaryStage,
): Promise<Map<string, number>> {
  const { cohort, inScope } = await dietaryScope();
  const exploded = db
    .select({
      item: sql<string>`jsonb_array_elements_text(${listAnswer(key)})`.as("item"),
    })
    .from(latest)
    .leftJoin(cohort, eq(cohort.email, latest.email))
    .where(and(inScope, inStage(stageOfLatest(sql`${cohort.stage}`), stage)))
    .as("exploded");
  const rows = await db
    .select({ item: exploded.item, n: count() })
    .from(exploded)
    .groupBy(exploded.item);
  return new Map(rows.map((r) => [r.item, r.n]));
}

/** The items with a count, the most first and in the checklist's order among equals. */
function ranked(counts: Map<string, number>): DietaryItemCount[] {
  return DIETARY_ITEMS.map((item) => ({ item, count: counts.get(item) ?? 0 }))
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count);
}

/**
 * The dietary needs of the current cohort at `stage`: how many people there
 * are, and how many checked and marked critical each item, whatever the
 * search. Critical is a subset of checked, so an item's not-critical count is
 * what is left of its checked count.
 */
export async function dietaryCounts(
  stage: DietaryStage,
): Promise<DietaryCounts> {
  const { cohort, inScope } = await dietaryScope();
  const stageOf = stageOfLatest(sql`${cohort.stage}`);
  const hasChecked = sql`jsonb_array_length(${listAnswer(DIETARY_KEYS.restrictions)}) > 0`;
  const hasCritical = sql`jsonb_array_length(${listAnswer(DIETARY_KEYS.critical)}) > 0`;
  const [[totals], [size], checked, marked] = await Promise.all([
    db
      .select({
        responded: count(),
        withNeeds: sql<number>`count(*) filter (where ${hasChecked})::int`,
        withCritical: sql<number>`count(*) filter (where ${hasCritical})::int`,
      })
      .from(latest)
      .leftJoin(cohort, eq(cohort.email, latest.email))
      .where(and(inScope, inStage(stageOf, stage))),
    db
      .select({
        n: count(),
        notRegistered: sql<number>`count(*) filter (where not exists (select 1 from intake_responses r where r.email = ${cohort.email}))::int`,
      })
      .from(cohort)
      .where(inStage(sql`${cohort.stage}`, stage)),
    itemCounts(DIETARY_KEYS.restrictions, stage),
    itemCounts(DIETARY_KEYS.critical, stage),
  ]);
  const notCritical = new Map(
    [...checked].map(([item, n]) => [item, n - (marked.get(item) ?? 0)]),
  );
  return {
    responded: totals?.responded ?? 0,
    withNeeds: totals?.withNeeds ?? 0,
    withCritical: totals?.withCritical ?? 0,
    cohortSize: size?.n ?? 0,
    notRegistered: size?.notRegistered ?? 0,
    critical: ranked(marked),
    notCritical: ranked(notCritical),
  };
}

export type WriteInRow = {
  email: string;
  /** Their name on record, which shows a preferred first name. */
  name: string | null;
  /** The stage they are in now; for a test group member, the form they answered. */
  stage: IntakeFormId;
  /** What they wrote in for "Other". */
  text: string;
};

/**
 * Who in the current cohort at `stage` checked "Other" and wrote something in,
 * and what: those who also marked it Critical (`critical`) or those who did
 * not, a page at a time.
 */
export async function listWriteIns(
  critical: boolean,
  stage: DietaryStage,
  query: ListQuery<WriteInSort>,
): Promise<Page<WriteInRow>> {
  const { limit, offset } = pageWindow(query.page);
  const { cohort, inScope } = await dietaryScope();
  const other = JSON.stringify([DIETARY_OTHER]);
  const text = sql<string>`btrim(${latest.answers} ->> ${sql.raw(`'${DIETARY_KEYS.other}'`)})`;
  const stageOf = stageOfLatest(sql`${cohort.stage}`);
  const sortColumn = {
    name: sql`lower(nullif(${named.fullName}, ''))`,
    email: latest.email,
    stage: stageOf,
  }[query.sort];
  const marked = sql`${listAnswer(DIETARY_KEYS.critical)} @> ${other}::jsonb`;
  const rows = await db
    .select({
      email: latest.email,
      name: sql<string | null>`${named.fullName}`,
      stage: sql<IntakeFormId>`${stageOf}`,
      text,
    })
    .from(latest)
    .leftJoin(named, eq(named.email, latest.email))
    .leftJoin(cohort, eq(cohort.email, latest.email))
    .where(
      and(
        inScope,
        inStage(stageOf, stage),
        sql`${listAnswer(DIETARY_KEYS.restrictions)} @> ${other}::jsonb`,
        critical ? marked : sql`not ${marked}`,
        sql`${text} <> ''`,
      ),
    )
    .orderBy(...orderFor(sortColumn, query.dir, sql`lower(${named.fullName})`, latest.email))
    .limit(limit)
    .offset(offset);
  return toPage(rows, query.page);
}

export type UnregisteredRow = {
  email: string;
  name: string | null;
  stage: IntakeFormId;
};

/**
 * Everyone in the current cohort who has sent neither form yet, a page at a
 * time, so the Dietary needs page names who is still to register. Someone at
 * intermediate who registered for bootcamp a cohort ago has answers, so is
 * not here: their bootcamp needs are counted until they answer again.
 */
export async function listUnregistered(
  query: ListQuery<UnregisteredSort>,
  stage: DietaryStage = "all",
): Promise<Page<UnregisteredRow>> {
  const { limit, offset } = pageWindow(query.page);
  const cohort = await currentCohortSubquery();
  const named = namedEmployees();
  const email = sql`${cohort.email}`;
  const sortColumn = {
    name: sql`lower(${named.fullName})`,
    email,
    stage: sql`${cohort.stage}`,
  }[query.sort];
  const rows = await db
    .select({
      email: cohort.email,
      name: named.fullName,
      stage: sql<IntakeFormId>`${cohort.stage}`,
    })
    .from(cohort)
    .leftJoin(named, eq(named.email, cohort.email))
    .where(
      and(
        sql`not exists (select 1 from intake_responses r where r.email = ${cohort.email})`,
        inStage(sql`${cohort.stage}`, stage),
        searchAny(query.q, [email, named.fullName]),
      ),
    )
    .orderBy(
      ...orderFor(sortColumn, query.dir, sql`lower(${named.fullName})`, email),
    )
    .limit(limit)
    .offset(offset);
  return toPage(rows, query.page);
}
