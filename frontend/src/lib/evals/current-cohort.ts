/**
 * The Cohorts page's Current tab: the org members still to train. Someone
 * with no BTC date is a bootcamp candidate; someone with a BTC date and no
 * INT date is an intermediate candidate. Anyone on the ignored or exempt
 * track is left out; a title on no list is listed as undecided until someone
 * sorts it, and someone who started too close to the next bootcamp is listed
 * as deferred. Read from `employees.track`, so it is as fresh as the last
 * sync or the last change that retracked anyone, whichever came later. Only
 * those recent enough by the candidate cutoffs count; see
 * `getCandidateCutoffs`.
 */

import "server-only";

import { and, eq, gt, gte, inArray, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import {
  bootcampHistory,
  employees,
  employeeTrackOverrides,
  evalsAssessments,
  evalsSubmissions,
  type Employee,
} from "@/db/schema";
import { getCandidateCutoffs, getDeferralDays, type CandidateCutoffs } from "@/lib/evals/settings";
import { nextBootcampStart } from "@/lib/evals/tracks";
import type { CurrentCohortSort } from "@/lib/list-specs";
import { PAGE_SIZE, pageWindow, toPage, type ListQuery, type Page } from "@/lib/paging";
import { blankAsNull, orderFor, searchAny } from "@/lib/paging-sql";
import { activeBootcamp } from "@/lib/scheduler/bootcamps";

export const CANDIDATE_STAGES = ["bootcamp", "intermediate"] as const;
export type CandidateStage = (typeof CANDIDATE_STAGES)[number];

export function isCandidateStage(value: unknown): value is CandidateStage {
  return CANDIDATE_STAGES.includes(value as CandidateStage);
}

/** A candidate's track: `undecided` for a title on no list. */
export const CANDIDATE_TRACKS = ["sales", "engineer", "undecided", "deferred"] as const;
export type CandidateTrack = (typeof CANDIDATE_TRACKS)[number];

export function isCandidateTrack(value: unknown): value is CandidateTrack {
  return CANDIDATE_TRACKS.includes(value as CandidateTrack);
}

/** At most one stage and one track; null for either shows them all. */
export type CurrentCohortFilter = { stage: CandidateStage | null; track: CandidateTrack | null };

export type CurrentCohortMember = Pick<
  Employee,
  | "email"
  | "fullName"
  | "title"
  | "department"
  | "site"
  | "reportsToEmail"
  | "reportsToName"
  | "startDate"
  | "activeEffectiveDate"
> & {
  track: CandidateTrack;
  /** Whether an administrator set that track by hand. */
  overridden: boolean;
  stage: CandidateStage;
  /** Their bootcamp history record; null for someone with none. */
  historyId: string | null;
  /** When they passed bootcamp; null for a bootcamp candidate. */
  btcDate: string | null;
  /** Their overall BTC result; null until scored, and for a caller outside eVals. */
  btcScore: number | null;
  /** Their score on each of `CohortScoring.assessments` at its bootcamp, by assessment id; only those scored. */
  scores: Record<string, number>;
  /** The mean of `scores`, to one decimal place; null when there are none. */
  averageScore: number | null;
};

/**
 * The score columns: the active assessments for one stage and one trained
 * track, in the eVals page's order, and the bootcamp their scores were given
 * at. That is the active bootcamp, or null when there is none or it holds no
 * intermediate class for an intermediate stage, which leaves every score empty.
 */
export type CohortScoring = { bootcampId: string | null; assessments: { id: string; name: string }[] };

/** How many candidates are in each stage on each track, whatever the search or filter. */
export type CurrentCohortCounts = Record<CandidateStage, Record<CandidateTrack, number>>;

export type CurrentCohortSummary = {
  counts: CurrentCohortCounts;
  /** When the sync that set those tracks ran; null if none has stored anyone. */
  syncedAt: Date | null;
  /** The cutoffs the counts and lists were drawn with. */
  cutoffs: CandidateCutoffs;
  /** The deferral window, and the start of the bootcamp it counts back from, if any. */
  deferral: { days: number; bootcampStart: string | null };
};

const e = employees;
const h = bootcampHistory;
const o = employeeTrackOverrides;
const a = evalsAssessments;
const s = evalsSubmissions;

const candidateTrack = sql<CandidateTrack>`coalesce(${e.track}, 'undecided')`;
const candidateStage = sql<CandidateStage>`(case when ${h.btcDate} is null then 'bootcamp' else 'intermediate' end)`;

/** Every sort but `averageScore`, which depends on the score columns and is added per query. */
const SORT_COLUMNS = {
  fullName: sql`lower(${e.fullName})`,
  email: e.email,
  title: sql`lower(${blankAsNull(e.title)})`,
  track: candidateTrack,
  btcDate: h.btcDate,
} as const;

/** Which stage a candidate is in, read off `bootcamp_history` joined as on `employees.email`. */
export const IN_STAGE: Record<CandidateStage, SQL> = {
  bootcamp: isNull(h.btcDate),
  intermediate: and(isNotNull(h.btcDate), isNull(h.intDate))!,
};

const ON_TRACK: Record<CandidateTrack, SQL> = {
  sales: eq(e.track, "sales"),
  engineer: eq(e.track, "engineer"),
  undecided: isNull(e.track),
  deferred: eq(e.track, "deferred"),
};

/**
 * In the org, in a stage, on a track still to train or none yet, and recent
 * enough by the cutoffs. Reads `employees` and `bootcamp_history`, the latter
 * left-joined on email; eVals scoring draws its attendees with it too.
 */
export function isCandidate({ startDateOnOrAfter, activeEffectiveDateAfter }: CandidateCutoffs) {
  return and(
    isNotNull(e.orgDepth),
    or(IN_STAGE.bootcamp, IN_STAGE.intermediate),
    or(isNull(e.track), inArray(e.track, ["sales", "engineer", "deferred"])),
    startDateOnOrAfter ? or(isNull(e.startDate), gte(e.startDate, startDateOnOrAfter)) : undefined,
    activeEffectiveDateAfter ? gt(e.activeEffectiveDate, activeEffectiveDateAfter) : undefined,
  );
}

/** Null unless the filter names a stage and Sales or Engineer: assessments are set per stage and per audience. */
export async function cohortScoring(filter: CurrentCohortFilter): Promise<CohortScoring | null> {
  const { stage, track } = filter;
  if (!stage || (track !== "sales" && track !== "engineer")) return null;
  const [assessments, bootcamp] = await Promise.all([
    db
      .select({ id: a.id, name: a.name })
      .from(a)
      .where(and(eq(a.active, true), eq(a.stage, stage), inArray(a.audience, [track, "both"])))
      .orderBy(sql`lower(${a.name})`, a.id)
      .limit(PAGE_SIZE),
    activeBootcamp(),
  ]);
  const holdsStage = bootcamp !== null && (stage === "bootcamp" || bootcamp.intDays !== null);
  return { bootcampId: holdsStage ? bootcamp.id : null, assessments };
}

/** Their submissions at the scoring bootcamp for the scoring assessments, as a correlated subquery's `from … where`. */
function scoredSubmissions({ bootcampId, assessments }: CohortScoring) {
  return sql`from ${s} where ${s.attendeeEmail} = ${e.email} and ${s.bootcampId} = ${bootcampId}
    and ${inArray(
      s.assessmentId,
      assessments.map((x) => x.id),
    )}`;
}

/**
 * One page of candidates, in one stage and on one track when the filter
 * names them. The search matches the name, email, title or track. Scores are
 * eVals' to show: `evals` is set only for a caller in eVals, and without it
 * `btcScore` is null and `scores` empty; its `scoring` fills `scores` and
 * `averageScore`.
 */
export async function listCurrentCohort(
  filter: CurrentCohortFilter,
  query: ListQuery<CurrentCohortSort>,
  evals?: { scoring: CohortScoring | null },
): Promise<Page<CurrentCohortMember>> {
  const { limit, offset } = pageWindow(query.page);
  const cutoffs = await getCandidateCutoffs();
  const scoring = evals?.scoring?.bootcampId && evals.scoring.assessments.length > 0 ? evals.scoring : null;
  // Without score columns every average is null, so sorting by it falls through to the name.
  const average = scoring
    ? sql<number | null>`(select round(avg(${s.averageScore})::numeric, 1)::float8 ${scoredSubmissions(scoring)})`
    : sql<number | null>`null::float8`;
  const sortColumns = { ...SORT_COLUMNS, averageScore: average };
  const rows = await db
    .select({
      email: e.email,
      fullName: e.fullName,
      title: e.title,
      department: e.department,
      site: e.site,
      reportsToEmail: e.reportsToEmail,
      reportsToName: e.reportsToName,
      startDate: e.startDate,
      activeEffectiveDate: e.activeEffectiveDate,
      track: candidateTrack,
      overridden: sql<boolean>`(${o.email} is not null)`,
      stage: candidateStage,
      historyId: h.id,
      btcDate: h.btcDate,
      btcScore: evals ? h.btcScore : sql<number | null>`null::float8`,
      scores: scoring
        ? sql<Record<string, number>>`coalesce((select jsonb_object_agg(${s.assessmentId}, ${s.averageScore}) ${scoredSubmissions(scoring)}), '{}'::jsonb)`
        : sql<Record<string, number>>`'{}'::jsonb`,
      averageScore: average,
    })
    .from(e)
    .leftJoin(h, sql`${h.email} = ${e.email}`)
    .leftJoin(o, sql`${o.email} = ${e.email}`)
    .where(
      and(
        isCandidate(cutoffs),
        filter.stage ? IN_STAGE[filter.stage] : undefined,
        filter.track ? ON_TRACK[filter.track] : undefined,
        searchAny(query.q, [e.fullName, e.email, e.title, candidateTrack]),
      ),
    )
    .orderBy(...orderFor(sortColumns[query.sort], query.dir, sql`lower(${e.fullName})`, e.id))
    .limit(limit)
    .offset(offset);
  return toPage(rows, query.page);
}

/** How many are in each stage on each track, as of which sync, and the rules that drew them. */
export async function currentCohortSummary(): Promise<CurrentCohortSummary> {
  const cutoffs = await getCandidateCutoffs();
  const [cells, [synced], days, bootcampStart] = await Promise.all([
    db
      .select({ stage: candidateStage, track: candidateTrack, count: sql<number>`count(*)::int` })
      .from(e)
      .leftJoin(h, sql`${h.email} = ${e.email}`)
      .where(isCandidate(cutoffs))
      .groupBy(candidateStage, candidateTrack),
    // A sync stamps every row with the same time.
    db.select({ at: sql<string | null>`max(${e.importedAt})` }).from(e),
    getDeferralDays(),
    nextBootcampStart(),
  ]);
  const zero = () => Object.fromEntries(CANDIDATE_TRACKS.map((t) => [t, 0])) as Record<CandidateTrack, number>;
  const counts: CurrentCohortCounts = { bootcamp: zero(), intermediate: zero() };
  for (const c of cells) counts[c.stage][c.track] = c.count;
  return {
    counts,
    syncedAt: synced?.at ? new Date(synced.at) : null,
    cutoffs,
    deferral: { days, bootcampStart },
  };
}
