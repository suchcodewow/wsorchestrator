/**
 * Reporting → Bootcamp: everyone's BTC and INT records, for every signed-in
 * user, each seeing only as much as they may.
 *
 * A record is a bootcamp history row (the imported sheet) or an eVals
 * submission. An Assessments Viewer or above sees every record and every
 * submission's scores and comments. Anyone else sees only the people below
 * them in HiBob's reporting lines — read live, so it follows each sync — and
 * of a bootcamp's submissions only the stages an Assessments Administrator
 * has released, which keeps a class still being judged out of view; what they
 * see of a submission is its score, never its comments.
 */

import "server-only";

import { and, asc, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  EVALS_ASSESSMENT_LIMITS,
  EXEMPT_DATE,
  bootcampHistory,
  bootcamps,
  employees,
  evalsAssessmentCriteria,
  evalsAssessments,
  evalsSubmissionScores,
  evalsSubmissions,
  users,
  type BootcampStatus,
  type Employee,
} from "@/db/schema";
import { averageScore, requiredFeedback, wholeScore } from "@/lib/evals/assessment-values";
import { updateHistory, type HistoryCorrection, type HistoryError } from "@/lib/evals/bootcamp-history";
import { isCandidate } from "@/lib/evals/current-cohort";
import { getCandidateCutoffs } from "@/lib/evals/settings";
import { retrackEmployees } from "@/lib/evals/tracks";
import type { BootcampCohortSort, BootcampRecordSort, HistoryStatus } from "@/lib/list-specs";
import { PAGE_SIZE, pageWindow, toPage, type ListQuery, type Page } from "@/lib/paging";
import { orderFor, searchAny } from "@/lib/paging-sql";
import {
  NOT_ATTENDED,
  historyClass,
  isExempt,
  type BootcampLevel,
  type ClassSummary,
  type ReleaseStage,
} from "@/lib/reporting/bootcamp-values";
import { canUseEvals, type Access } from "@/lib/roles";

/**
 * Who is reading: `all` for an Assessments Viewer or above, who sees every
 * record; anyone else sees the org below `email`, or no one without one.
 */
export type BootcampReader = { all: boolean; email: string | null };

export function readerOf(caller: { access: Access; email: string | null }): BootcampReader {
  return { all: canUseEvals(caller.access), email: caller.email?.trim().toLowerCase() || null };
}

/**
 * True when the reader may see the person `email` (lowercased): anyone, for
 * an Assessments Viewer; else someone whose chain of managers in the last
 * HiBob sync reaches the reader, the reader themself left out. `union` stops a
 * loop in the reporting lines.
 */
function inReach(reader: BootcampReader, email: SQL): SQL {
  if (reader.all) return sql`true`;
  if (!reader.email) return sql`false`;
  return sql`(${email} <> ${reader.email} and ${email} in (
    with recursive org(email) as (
      select m.email from ${employees} m where m.reports_to_email = ${reader.email}
      union
      select r.email from ${employees} r join org on r.reports_to_email = org.email
    )
    select email from org))`;
}

/** A submission at bootcamp `b` for assessment `a` may be shown: always to a viewer, else once its stage is released. */
function released(reader: BootcampReader): SQL {
  if (reader.all) return sql`true`;
  return sql`(case a.stage when 'bootcamp' then b.btc_released_at is not null else b.int_released_at is not null end)`;
}

/**
 * Every record the reader may see, past the current cohort: one row per
 * class someone has a history date for, and per class of a finished bootcamp
 * they were scored at. The exempt marker is kept, as a class with no day.
 */
function pastRecords(reader: BootcampReader): SQL {
  return sql`(
    select h.email, 'bootcamp'::text as stage, h.btc_date as day from ${bootcampHistory} h where h.btc_date is not null
    union all
    select h.email, 'intermediate', h.int_date from ${bootcampHistory} h where h.int_date is not null
    union all
    select distinct s.attendee_email, a.stage, b.start_date
      from ${evalsSubmissions} s
      join ${evalsAssessments} a on a.id = s.assessment_id
      join ${bootcamps} b on b.id = s.bootcamp_id
     where b.status = 'complete' and ${released(reader)}
  )`;
}

const nameOf = (email: SQL) =>
  sql`(select n.full_name from ${employees} n where n.email = ${email} order by n.full_name limit 1)`;

/**
 * How a person's page is addressed: their HiBob id while they are in the
 * employee list, else their history row's id, else one of their submissions'.
 * `resolvePerson` reads any of the three back.
 */
const keyOf = (email: SQL) => sql`coalesce(
  (select n.id from ${employees} n where n.email = ${email} order by n.id limit 1),
  (select h.id::text from ${bootcampHistory} h where h.email = ${email}),
  (select min(s.id::text) from ${evalsSubmissions} s where s.attendee_email = ${email}))`;

const ATTENDED = (stage: ReleaseStage) => sql`bool_or(r.stage = ${stage} and r.day <> ${EXEMPT_DATE})`;

/** One row per person in reach with a past record: their level, latest class day, name, key and whether they are still here. */
function people(reader: BootcampReader): SQL {
  return sql`(
    select r.email,
           (case when ${ATTENDED("intermediate")} then 'intermediate'
                 when ${ATTENDED("bootcamp")} then 'bootcamp' else 'exempt' end) as level,
           (case when ${ATTENDED("intermediate")} then 2 when ${ATTENDED("bootcamp")} then 1 else 0 end) as rank,
           (max(r.day) filter (where r.day <> ${EXEMPT_DATE}))::text as date,
           ${nameOf(sql`r.email`)} as full_name,
           exists (select 1 from ${employees} n where n.email = r.email) as active,
           ${keyOf(sql`r.email`)} as key
      from ${pastRecords(reader)} r
     where ${inReach(reader, sql`r.email`)}
     group by r.email
  )`;
}

const STATUS_FILTER: Record<HistoryStatus, SQL> = { active: sql`p.active`, inactive: sql`not p.active` };

const RECORD_SORT_COLUMNS: Record<BootcampRecordSort, SQL> = {
  date: sql`p.date`,
  fullName: sql`lower(p.full_name)`,
  email: sql`p.email`,
  level: sql`p.rank`,
};

export type BootcampRecordRow = {
  key: string;
  email: string;
  fullName: string | null;
  level: BootcampLevel;
  /** Their latest BTC or INT day; null when every class they have is exempt. */
  date: string | null;
  /** In the employee list from the last HiBob sync. */
  active: boolean;
};

/** One page of the people the reader may see with a record, newest class first by default; the search matches the name or email. */
export async function listBootcampRecords(
  reader: BootcampReader,
  query: ListQuery<BootcampRecordSort>,
  status: HistoryStatus | null = null,
): Promise<Page<BootcampRecordRow>> {
  const { limit, offset } = pageWindow(query.page);
  const where = and(sql`true`, searchAny(query.q, [sql`p.full_name`, sql`p.email`]), status ? STATUS_FILTER[status] : undefined);
  // A class shares one day, so its people fall back to name order.
  const order = orderFor(RECORD_SORT_COLUMNS[query.sort], query.dir, sql`lower(p.full_name) asc nulls last`, sql`p.email`);
  const { rows } = await db.execute<BootcampRecordRow>(sql`
    select p.key, p.email, p.full_name as "fullName", p.level, p.date, p.active
      from ${people(reader)} p
     where ${where}
     order by ${sql.join(order, sql`, `)}
     limit ${limit} offset ${offset}`);
  return toPage(rows, query.page);
}

export type BootcampRecordCounts = { total: number } & Record<HistoryStatus, number>;

/** How many people the reader may see with a record, and how many are still here, whatever the search. */
export async function bootcampRecordCounts(reader: BootcampReader): Promise<BootcampRecordCounts> {
  const { rows } = await db.execute<{ total: number; active: number }>(sql`
    select count(*)::int as total, (count(*) filter (where p.active))::int as active from ${people(reader)} p`);
  const total = rows[0]?.total ?? 0;
  const active = rows[0]?.active ?? 0;
  return { total, active, inactive: total - active };
}

/** The active bootcamp and whether each class's scores are out. */
export type CohortBootcamp = {
  id: string;
  startDate: string;
  /** False when it holds no intermediate class. */
  intermediate: boolean;
  released: Record<ReleaseStage, { at: Date; byName: string | null } | null>;
};

const btcReleaser = sql`(select coalesce(nullif(u.name, ''), u.email) from ${users} u where u.id = ${bootcamps.btcReleasedBy})`;
const intReleaser = sql`(select coalesce(nullif(u.name, ''), u.email) from ${users} u where u.id = ${bootcamps.intReleasedBy})`;

/** The active bootcamp, or null when none is. */
export async function cohortBootcamp(): Promise<CohortBootcamp | null> {
  const [row] = await db
    .select({
      id: bootcamps.id,
      startDate: bootcamps.startDate,
      intDays: bootcamps.intDays,
      btcReleasedAt: bootcamps.btcReleasedAt,
      btcReleasedBy: sql<string | null>`${btcReleaser}`,
      intReleasedAt: bootcamps.intReleasedAt,
      intReleasedBy: sql<string | null>`${intReleaser}`,
    })
    .from(bootcamps)
    .where(eq(bootcamps.status, "active"));
  if (!row) return null;
  return {
    id: row.id,
    startDate: row.startDate,
    intermediate: row.intDays !== null,
    released: {
      bootcamp: row.btcReleasedAt ? { at: row.btcReleasedAt, byName: row.btcReleasedBy } : null,
      intermediate: row.intReleasedAt ? { at: row.intReleasedAt, byName: row.intReleasedBy } : null,
    },
  };
}

/** The stages of `bootcamp` the reader may see the cohort of. */
export function visibleStages(reader: BootcampReader, bootcamp: CohortBootcamp): ReleaseStage[] {
  const held: ReleaseStage[] = bootcamp.intermediate ? ["bootcamp", "intermediate"] : ["bootcamp"];
  return reader.all ? held : held.filter((stage) => bootcamp.released[stage] !== null);
}

export type CohortRow = {
  key: string;
  email: string;
  fullName: string | null;
  stage: ReleaseStage;
  /** Assessments they have a submission for at this bootcamp, in their stage. */
  scored: number;
  /** The mean of those submissions' averages, to one decimal place; null with none. */
  averageScore: number | null;
};

const COHORT_SORT_COLUMNS: Record<BootcampCohortSort, SQL> = {
  fullName: sql`lower(m.full_name)`,
  email: sql`m.email`,
  stage: sql`m.stage`,
  averageScore: sql`m.average`,
};

/**
 * One page of the active bootcamp's cohort in reach of the reader: the
 * current candidates in a class it holds, and anyone already scored at it.
 * Empty for a stage the reader may not see yet.
 */
export async function listCohort(
  reader: BootcampReader,
  bootcamp: CohortBootcamp,
  query: ListQuery<BootcampCohortSort>,
): Promise<Page<CohortRow>> {
  const stages = visibleStages(reader, bootcamp);
  if (stages.length === 0) return toPage([], query.page);
  const { limit, offset } = pageWindow(query.page);
  const cutoffs = await getCandidateCutoffs();
  const scoredIn = sql`from ${evalsSubmissions} s join ${evalsAssessments} a on a.id = s.assessment_id
    where s.bootcamp_id = ${bootcamp.id} and s.attendee_email = c.email and a.stage = c.stage`;
  const order = orderFor(COHORT_SORT_COLUMNS[query.sort], query.dir, sql`lower(m.full_name) asc nulls last`, sql`m.email`);
  const { rows } = await db.execute<CohortRow>(sql`
    with candidates as (
      select ${employees.email} as email,
             -- A BTC date from this bootcamp's own release still counts them in its BTC class.
             (case when ${bootcampHistory.btcDate} is null or ${bootcampHistory.btcDate} >= ${bootcamp.startDate}
                   then 'bootcamp' else 'intermediate' end) as stage
        from ${employees} left join ${bootcampHistory} on ${bootcampHistory.email} = ${employees.email}
       where ${and(isCandidate(cutoffs), inArray(employees.track, ["sales", "engineer"]))}
      union
      select s.attendee_email, a.stage
        from ${evalsSubmissions} s join ${evalsAssessments} a on a.id = s.assessment_id
       where s.bootcamp_id = ${bootcamp.id}
    ),
    cohort as (
      -- Someone scored in both classes is listed once, at the further.
      select distinct on (email) email, stage from candidates
       where stage in (${sql.join(stages.map((st) => sql`${st}`), sql`, `)})
       order by email, stage desc
    ),
    members as (
      select c.email, c.stage, ${nameOf(sql`c.email`)} as full_name, ${keyOf(sql`c.email`)} as key,
             (select count(*)::int ${scoredIn}) as scored,
             (select round(avg(s.average_score)::numeric, 1)::float8 ${scoredIn}) as average
        from cohort c
       where ${inReach(reader, sql`c.email`)}
    )
    select m.key, m.email, m.full_name as "fullName", m.stage, m.scored, m.average as "averageScore"
      from members m
     where ${and(sql`true`, searchAny(query.q, [sql`m.full_name`, sql`m.email`]))}
     order by ${sql.join(order, sql`, `)}
     limit ${limit} offset ${offset}`);
  return toPage(rows, query.page);
}

export type ReleaseError = "no_bootcamp" | "no_intermediate";

export const RELEASE_STATUS_FOR: Record<ReleaseError, number> = { no_bootcamp: 409, no_intermediate: 409 };

/**
 * Releases one class of the active bootcamp to managers, from now on, and
 * completes it: everyone scored in that class gets the bootcamp's start date
 * as their BTC or INT date in `bootcamp_history`, with the mean of their
 * submissions' averages as the class score and each assessment's average as
 * an exercise score. That moves a BTC class on to Intermediate on Cohorts →
 * Current, and takes an INT class off it. Once released it stays so;
 * releasing again changes nothing, and says when it was.
 */
export async function releaseScores(
  actorId: string,
  stage: ReleaseStage,
): Promise<
  | { ok: true; bootcamp: { id: string; startDate: string }; releasedAt: Date; written: number }
  | { ok: false; error: ReleaseError }
> {
  const bootcamp = await cohortBootcamp();
  if (!bootcamp) return { ok: false, error: "no_bootcamp" };
  if (stage === "intermediate" && !bootcamp.intermediate) return { ok: false, error: "no_intermediate" };
  const done = { id: bootcamp.id, startDate: bootcamp.startDate };
  const already = bootcamp.released[stage];
  if (already) return { ok: true, bootcamp: done, releasedAt: already.at, written: 0 };

  const now = new Date();
  const [atColumn, byColumn] =
    stage === "bootcamp"
      ? (["btcReleasedAt", "btcReleasedBy"] as const)
      : (["intReleasedAt", "intReleasedBy"] as const);
  const result = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(bootcamps)
      .set({ [atColumn]: now, [byColumn]: actorId, updatedAt: now })
      .where(and(eq(bootcamps.id, bootcamp.id), isNull(bootcamps[atColumn])))
      .returning({ at: bootcamps[atColumn] });
    // Someone else released it between our read and our write, and wrote the history with it.
    if (!row) return null;
    return { releasedAt: row.at ?? now, emails: await writeClassHistory(tx, done, stage, actorId) };
  });
  if (!result) {
    return { ok: true, bootcamp: done, releasedAt: (await cohortBootcamp())?.released[stage]?.at ?? now, written: 0 };
  }
  await retrackEmployees(result.emails);
  return { ok: true, bootcamp: done, releasedAt: result.releasedAt, written: result.emails.length };
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Writes one class of `bootcamp` into `bootcamp_history` for everyone scored
 * in it, or only for `only`: its start date, the mean of their submissions'
 * averages, and each assessment's average by name. Creates the row for
 * someone with none; leaves the other class's columns alone. Returns whose
 * rows it wrote.
 */
async function writeClassHistory(
  tx: Tx,
  bootcamp: { id: string; startDate: string },
  stage: ReleaseStage,
  actorId: string,
  only?: string,
): Promise<string[]> {
  const [date, score, exercises] =
    stage === "bootcamp"
      ? [sql.raw("btc_date"), sql.raw("btc_score"), sql.raw("btc_individual_scores")]
      : [sql.raw("int_date"), sql.raw("int_score"), sql.raw("int_individual_scores")];
  const { rows } = await tx.execute<{ email: string }>(sql`
    insert into ${bootcampHistory} (email, ${date}, ${score}, ${exercises}, updated_by)
    select lower(s.attendee_email), ${bootcamp.startDate}::date,
           round(avg(s.average_score)::numeric, 1)::float8,
           jsonb_object_agg(s.assessment_name, s.average_score),
           ${actorId}
      from ${evalsSubmissions} s join ${evalsAssessments} a on a.id = s.assessment_id
     where s.bootcamp_id = ${bootcamp.id} and a.stage = ${stage}
       ${only ? sql`and lower(s.attendee_email) = ${only.toLowerCase()}` : sql``}
     group by lower(s.attendee_email)
    on conflict (email) do update
       set ${date} = excluded.${date}, ${score} = excluded.${score}, ${exercises} = excluded.${exercises},
           updated_by = excluded.updated_by, updated_at = now()
    returning email`);
  return rows.map((r) => r.email);
}

const uuidSchema = z.string().uuid();

/**
 * The email a person's key (see `keyOf`) stands for: a history row's id, a
 * submission's, or a HiBob id. Null for none of them.
 */
async function resolvePerson(key: string): Promise<string | null> {
  if (uuidSchema.safeParse(key).success) {
    const [history] = await db
      .select({ email: bootcampHistory.email })
      .from(bootcampHistory)
      .where(eq(bootcampHistory.id, key));
    if (history) return history.email;
    const [submission] = await db
      .select({ email: evalsSubmissions.attendeeEmail })
      .from(evalsSubmissions)
      .where(eq(evalsSubmissions.id, key));
    if (submission) return submission.email;
  }
  if (key.length > 64) return null;
  const [employee] = await db.select({ email: employees.email }).from(employees).where(eq(employees.id, key));
  return employee?.email ?? null;
}

export type PersonEmployee = Pick<
  Employee,
  "fullName" | "title" | "department" | "site" | "reportsToName" | "reportsToEmail" | "startDate" | "track"
>;

/** One criterion of a submission. */
export type SubmissionScore = { criterionId: string; criterionName: string; score: number; comment: string };

/** One assessment of the person, whole, as an Assessments Viewer sees it. */
export type PersonSubmission = {
  id: string;
  bootcamp: { id: string; startDate: string; status: BootcampStatus };
  stage: ReleaseStage;
  assessmentName: string;
  averageScore: number;
  positiveFeedback: string;
  constructiveFeedback: string;
  /** Whoever saved it last, by name or else email. */
  ownerName: string | null;
  submittedAt: Date;
  /** Also the version an edit must name. */
  updatedAt: Date;
  /** Managers can see its score. */
  released: boolean;
  scores: SubmissionScore[];
};

/** Their bootcamp history row, whole. */
export type PersonHistory = {
  id: string;
  btcDate: string | null;
  intDate: string | null;
  btcScore: number | null;
  intScore: number | null;
  btcIndividualScores: Record<string, number> | null;
  intIndividualScores: Record<string, number> | null;
  createdAt: Date;
  updatedAt: Date;
  updatedByName: string | null;
};

export type BootcampPerson = {
  key: string;
  email: string;
  /** From the last HiBob sync; null for someone no longer in it. */
  employee: PersonEmployee | null;
  /** BTC and INT as a manager sees them. */
  classes: Record<ReleaseStage, ClassSummary>;
  /** Null for a reader outside Assessments: the record behind `classes`, which only Assessments sees. */
  records: { history: PersonHistory | null; submissions: PersonSubmission[] } | null;
};

/**
 * One person's BTC and INT for the reader, or null when the key names no one
 * or someone out of their reach. A manager gets `classes` alone; an
 * Assessments Viewer also gets every submission, comments and all.
 */
export async function getBootcampPerson(reader: BootcampReader, key: string): Promise<BootcampPerson | null> {
  const email = await resolvePerson(key);
  if (!email) return null;
  if (!reader.all) {
    const { rows } = await db.execute<{ ok: boolean }>(sql`select ${inReach(reader, sql`${email}`)} as ok`);
    if (!rows[0]?.ok) return null;
  }

  const s = evalsSubmissions;
  const [[employee], [history], submitted] = await Promise.all([
    db
      .select({
        fullName: employees.fullName,
        title: employees.title,
        department: employees.department,
        site: employees.site,
        reportsToName: employees.reportsToName,
        reportsToEmail: employees.reportsToEmail,
        startDate: employees.startDate,
        track: employees.track,
      })
      .from(employees)
      .where(eq(employees.email, email))
      .orderBy(asc(employees.fullName))
      .limit(1),
    db
      .select({
        id: bootcampHistory.id,
        btcDate: bootcampHistory.btcDate,
        intDate: bootcampHistory.intDate,
        btcScore: bootcampHistory.btcScore,
        intScore: bootcampHistory.intScore,
        btcIndividualScores: bootcampHistory.btcIndividualScores,
        intIndividualScores: bootcampHistory.intIndividualScores,
        createdAt: bootcampHistory.createdAt,
        updatedAt: bootcampHistory.updatedAt,
        updatedByName: sql<string | null>`coalesce(nullif(${users.name}, ''), ${users.email})`,
      })
      .from(bootcampHistory)
      .leftJoin(users, eq(users.id, bootcampHistory.updatedBy))
      .where(eq(bootcampHistory.email, email)),
    db
      .select({
        id: s.id,
        bootcamp: { id: bootcamps.id, startDate: bootcamps.startDate, status: bootcamps.status },
        stage: evalsAssessments.stage,
        assessmentName: s.assessmentName,
        averageScore: s.averageScore,
        positiveFeedback: s.positiveFeedback,
        constructiveFeedback: s.constructiveFeedback,
        ownerName: sql<string | null>`coalesce(nullif(${users.name}, ''), ${users.email})`,
        submittedAt: s.submittedAt,
        updatedAt: s.updatedAt,
        released: sql<boolean>`(case ${evalsAssessments.stage} when 'bootcamp' then ${bootcamps.btcReleasedAt} is not null else ${bootcamps.intReleasedAt} is not null end)`,
      })
      .from(s)
      .innerJoin(bootcamps, eq(bootcamps.id, s.bootcampId))
      .innerJoin(evalsAssessments, eq(evalsAssessments.id, s.assessmentId))
      .leftJoin(users, eq(users.id, s.ownerId))
      .where(eq(s.attendeeEmail, email))
      .orderBy(desc(bootcamps.startDate), asc(evalsAssessments.stage), sql`lower(${s.assessmentName})`, s.id)
      .limit(PAGE_SIZE),
  ]);
  const visible = reader.all ? submitted : submitted.filter((x) => x.released);

  const classes = {
    bootcamp: classFor("bootcamp", history ? historyClass(history.btcDate, history.btcScore, history.btcIndividualScores) : null, visible),
    intermediate: classFor("intermediate", history ? historyClass(history.intDate, history.intScore, history.intIndividualScores) : null, visible),
  };
  if (!reader.all) return { key, email, employee: employee ?? null, classes, records: null };

  const ids = visible.map((x) => x.id);
  const scores =
    ids.length === 0
      ? []
      : await db
          .select({
            submissionId: evalsSubmissionScores.submissionId,
            criterionId: evalsSubmissionScores.criterionId,
            criterionName: evalsSubmissionScores.criterionName,
            score: evalsSubmissionScores.score,
            comment: evalsSubmissionScores.comment,
          })
          .from(evalsSubmissionScores)
          .leftJoin(evalsAssessmentCriteria, eq(evalsAssessmentCriteria.id, evalsSubmissionScores.criterionId))
          .where(inArray(evalsSubmissionScores.submissionId, ids))
          // The order the form asks them in.
          .orderBy(sql`${evalsAssessmentCriteria.position} nulls last`, evalsSubmissionScores.criterionName)
          .limit(ids.length * EVALS_ASSESSMENT_LIMITS.criteria);
  const scoresOf = new Map<string, SubmissionScore[]>();
  for (const { submissionId, ...score } of scores) {
    scoresOf.set(submissionId, [...(scoresOf.get(submissionId) ?? []), score]);
  }

  return {
    key,
    email,
    employee: employee ?? null,
    classes,
    records: {
      history: history ?? null,
      submissions: visible.map((x) => ({ ...x, scores: scoresOf.get(x.id) ?? [] })),
    },
  };
}

/**
 * One class as a manager sees it: the newest bootcamp they were scored at in
 * it, unless their history row has a later day; an exempt marker gives way to
 * any class they were scored at.
 */
function classFor(
  stage: ReleaseStage,
  fromHistory: ClassSummary | null,
  submitted: { bootcamp: { id: string; startDate: string }; stage: ReleaseStage; assessmentName: string; averageScore: number }[],
): ClassSummary {
  const inStage = submitted.filter((x) => x.stage === stage);
  // Newest bootcamp first, as fetched.
  const newest = inStage[0]?.bootcamp;
  const scored = newest ? inStage.filter((x) => x.bootcamp.id === newest.id) : [];
  const fromEvals: ClassSummary | null = newest
    ? {
        date: newest.startDate,
        score: averageScore(scored.map((x) => x.averageScore)),
        exercises: scored.map((x) => ({ name: x.assessmentName, score: x.averageScore })),
      }
    : null;

  if (!fromHistory?.date) return fromEvals ?? NOT_ATTENDED;
  if (!fromEvals) return fromHistory;
  if (isExempt(fromHistory.date)) return fromEvals;
  return fromEvals.date! >= fromHistory.date ? fromEvals : fromHistory;
}

const L = EVALS_ASSESSMENT_LIMITS;

/** An administrator's correction to a submission: every criterion it was scored on, and both feedback boxes. */
export const submissionEditSchema = z.object({
  scores: z
    .array(
      z.object({
        criterionId: z.string().uuid(),
        score: z.number().int().min(1).max(4),
        comment: z.string().trim().max(L.comment).default(""),
      }),
    )
    .min(1)
    .max(L.criteria),
  positiveFeedback: z.string().trim().max(L.feedback).default(""),
  constructiveFeedback: z.string().trim().max(L.feedback).default(""),
  /** The `updatedAt` of the version this corrects. */
  revises: z.string().datetime({ offset: true }),
});

export type SubmissionEdit = z.infer<typeof submissionEditSchema>;

export type SubmissionEditError = "invalid" | "not_found" | "feedback_required" | "conflict";

export const SUBMISSION_EDIT_STATUS_FOR: Record<SubmissionEditError, number> = {
  invalid: 400,
  not_found: 404,
  feedback_required: 400,
  conflict: 409,
};

/**
 * Corrects a submission's scores, comments and feedback in place, at any
 * bootcamp. It keeps the criteria it was scored on, their names as scored,
 * its owner and its tags; the average follows the new scores, and the
 * feedback the eVals form requires for it still is. In a class already
 * released, the person's history for that class is written again.
 */
export async function editSubmission(
  actorId: string,
  id: string,
  input: SubmissionEdit,
): Promise<
  | { ok: true; submission: { id: string; attendeeEmail: string; assessmentName: string; averageScore: number; updatedAt: Date } }
  | { ok: false; error: SubmissionEditError }
> {
  const s = evalsSubmissions;
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({
        id: s.id,
        attendeeEmail: s.attendeeEmail,
        assessmentName: s.assessmentName,
        updatedAt: s.updatedAt,
        stage: evalsAssessments.stage,
        bootcampId: bootcamps.id,
        startDate: bootcamps.startDate,
        btcReleasedAt: bootcamps.btcReleasedAt,
        intReleasedAt: bootcamps.intReleasedAt,
      })
      .from(s)
      .innerJoin(evalsAssessments, eq(evalsAssessments.id, s.assessmentId))
      .leftJoin(bootcamps, eq(bootcamps.id, s.bootcampId))
      .where(eq(s.id, id))
      .for("update", { of: s });
    if (!current) return { ok: false as const, error: "not_found" as const };
    if (current.updatedAt.getTime() !== Date.parse(input.revises)) return { ok: false as const, error: "conflict" as const };

    const scored = await tx
      .select({ criterionId: evalsSubmissionScores.criterionId, criterionName: evalsSubmissionScores.criterionName })
      .from(evalsSubmissionScores)
      .where(eq(evalsSubmissionScores.submissionId, id))
      .limit(L.criteria);
    const given = new Map(input.scores.map((sc) => [sc.criterionId, sc]));
    if (given.size !== input.scores.length || given.size !== scored.length || scored.some((c) => !given.has(c.criterionId))) {
      return { ok: false as const, error: "invalid" as const };
    }

    const average = averageScore(input.scores.map((sc) => sc.score))!;
    const needed = requiredFeedback(wholeScore(average));
    if (needed === "constructive" && !input.constructiveFeedback) return { ok: false as const, error: "feedback_required" as const };
    if (needed === "positive" && !input.positiveFeedback) return { ok: false as const, error: "feedback_required" as const };

    const now = new Date();
    await tx
      .update(s)
      .set({
        averageScore: average,
        positiveFeedback: input.positiveFeedback,
        constructiveFeedback: input.constructiveFeedback,
        updatedAt: now,
      })
      .where(eq(s.id, id));
    await tx.delete(evalsSubmissionScores).where(eq(evalsSubmissionScores.submissionId, id));
    await tx.insert(evalsSubmissionScores).values(
      scored.map((c) => ({
        submissionId: id,
        criterionId: c.criterionId,
        criterionName: c.criterionName,
        score: given.get(c.criterionId)!.score,
        comment: given.get(c.criterionId)!.comment,
      })),
    );
    // A released class has had its history written; keep that in step with the edit.
    const releasedAt = current.stage === "bootcamp" ? current.btcReleasedAt : current.intReleasedAt;
    if (current.bootcampId && current.startDate && releasedAt) {
      const bootcamp = { id: current.bootcampId, startDate: current.startDate };
      await writeClassHistory(tx, bootcamp, current.stage, actorId, current.attendeeEmail);
    }
    return {
      ok: true as const,
      submission: {
        id,
        attendeeEmail: current.attendeeEmail,
        assessmentName: current.assessmentName,
        averageScore: average,
        updatedAt: now,
      },
    };
  });
}

/** Corrects someone's bootcamp history row; says whose it was, for the audit trail. */
export async function correctHistory(
  actorId: string,
  id: string,
  correction: HistoryCorrection,
): Promise<{ ok: true; email: string } | { ok: false; error: HistoryError }> {
  const result = await updateHistory(actorId, id, correction);
  if (!result.ok) return result;
  const [row] = await db.select({ email: bootcampHistory.email }).from(bootcampHistory).where(eq(bootcampHistory.id, id));
  return row ? { ok: true, email: row.email } : { ok: false, error: "not_found" };
}
