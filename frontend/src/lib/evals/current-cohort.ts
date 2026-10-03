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
import { bootcampHistory, employees, employeeTrackOverrides, type Employee } from "@/db/schema";
import { getCandidateCutoffs, getDeferralDays, type CandidateCutoffs } from "@/lib/evals/settings";
import { nextBootcampStart } from "@/lib/evals/tracks";
import type { CurrentCohortSort } from "@/lib/list-specs";
import { pageWindow, toPage, type ListQuery, type Page } from "@/lib/paging";
import { blankAsNull, orderFor, searchAny } from "@/lib/paging-sql";

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
  "email" | "fullName" | "title" | "department" | "reportsToEmail" | "reportsToName"
> & {
  track: CandidateTrack;
  /** Whether an administrator set that track by hand. */
  overridden: boolean;
  stage: CandidateStage;
  /** When they passed bootcamp; null for a bootcamp candidate. */
  btcDate: string | null;
};

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

const candidateTrack = sql<CandidateTrack>`coalesce(${e.track}, 'undecided')`;
const candidateStage = sql<CandidateStage>`(case when ${h.btcDate} is null then 'bootcamp' else 'intermediate' end)`;

const SORT_COLUMNS = {
  fullName: sql`lower(${e.fullName})`,
  email: e.email,
  title: sql`lower(${blankAsNull(e.title)})`,
  department: sql`lower(${blankAsNull(e.department)})`,
  reportsToName: sql`lower(coalesce(${blankAsNull(e.reportsToName)}, ${blankAsNull(e.reportsToEmail)}))`,
  track: candidateTrack,
  stage: candidateStage,
  btcDate: h.btcDate,
} as const;

const IN_STAGE: Record<CandidateStage, SQL> = {
  bootcamp: isNull(h.btcDate),
  intermediate: and(isNotNull(h.btcDate), isNull(h.intDate))!,
};

const ON_TRACK: Record<CandidateTrack, SQL> = {
  sales: eq(e.track, "sales"),
  engineer: eq(e.track, "engineer"),
  undecided: isNull(e.track),
  deferred: eq(e.track, "deferred"),
};

/** In the org, in a stage, on a track still to train or none yet, and recent enough by the cutoffs. */
function isCandidate({ startDateOnOrAfter, activeEffectiveDateAfter }: CandidateCutoffs) {
  return and(
    isNotNull(e.orgDepth),
    or(IN_STAGE.bootcamp, IN_STAGE.intermediate),
    or(isNull(e.track), inArray(e.track, ["sales", "engineer", "deferred"])),
    startDateOnOrAfter ? or(isNull(e.startDate), gte(e.startDate, startDateOnOrAfter)) : undefined,
    activeEffectiveDateAfter ? gt(e.activeEffectiveDate, activeEffectiveDateAfter) : undefined,
  );
}

/**
 * One page of candidates, in one stage and on one track when the filter
 * names them. The search matches the name, email, title, department, manager
 * or track.
 */
export async function listCurrentCohort(
  filter: CurrentCohortFilter,
  query: ListQuery<CurrentCohortSort>,
): Promise<Page<CurrentCohortMember>> {
  const { limit, offset } = pageWindow(query.page);
  const cutoffs = await getCandidateCutoffs();
  const rows = await db
    .select({
      email: e.email,
      fullName: e.fullName,
      title: e.title,
      department: e.department,
      reportsToEmail: e.reportsToEmail,
      reportsToName: e.reportsToName,
      track: candidateTrack,
      overridden: sql<boolean>`(${o.email} is not null)`,
      stage: candidateStage,
      btcDate: h.btcDate,
    })
    .from(e)
    .leftJoin(h, sql`${h.email} = ${e.email}`)
    .leftJoin(o, sql`${o.email} = ${e.email}`)
    .where(
      and(
        isCandidate(cutoffs),
        filter.stage ? IN_STAGE[filter.stage] : undefined,
        filter.track ? ON_TRACK[filter.track] : undefined,
        searchAny(query.q, [e.fullName, e.email, e.title, e.department, e.reportsToName, e.reportsToEmail, candidateTrack]),
      ),
    )
    .orderBy(...orderFor(SORT_COLUMNS[query.sort], query.dir, sql`lower(${e.fullName})`, e.id))
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
