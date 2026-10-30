/**
 * The Cohorts page's Current and Deferred tabs: the org members still to
 * train. Someone who has not attended a BTC class is a bootcamp candidate;
 * someone who has, and has not attended an INT class, is an intermediate
 * candidate (`lib/evals/attendance.ts`). Anyone on the ignored or
 * exempt track is left out; a title on no list is listed as undecided until
 * someone sorts it, and someone who started too close to the next bootcamp is
 * deferred, which puts them on the Deferred tab rather than Current. Read from `employees.track`, so it is as fresh as the last
 * sync or the last change that retracked anyone, whichever came later. Only
 * those recent enough by the candidate cutoffs count; see
 * `getCandidateCutoffs`.
 */

import "server-only";

import { and, eq, gt, gte, inArray, isNotNull, isNull, not, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { employees, intakeResponses, type Employee } from "@/db/schema";
import { attended, classDate } from "@/lib/evals/attendance";
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

/** The tracks on the Current tab; the deferred have a tab of their own. */
export const CURRENT_TRACKS = ["sales", "engineer", "undecided"] as const;
export type CurrentTrack = (typeof CURRENT_TRACKS)[number];

export function isCurrentTrack(value: unknown): value is CurrentTrack {
  return CURRENT_TRACKS.includes(value as CurrentTrack);
}

/** At most one stage and one track; null for the stage shows both, and for the track every one but deferred. */
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
  /** Their employee id, for their Reporting → Live Sessions page; null for someone who has attended no class. */
  recordKey: string | null;
  /** The day of the BTC class they attended; null for a bootcamp candidate. */
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

const candidateTrack = sql<CandidateTrack>`coalesce(${e.track}, 'undecided')`;
const attendedBtc = attended("bootcamp", sql`${e.email}`);
const attendedInt = attended("intermediate", sql`${e.email}`);
const candidateStage = sql<CandidateStage>`(case when ${attendedBtc} then 'intermediate' else 'bootcamp' end)`;
const btcDate = classDate("bootcamp", sql`${e.email}`);

const SORT_COLUMNS = {
  fullName: sql`lower(${e.fullName})`,
  email: e.email,
  title: sql`lower(${blankAsNull(e.title)})`,
  track: candidateTrack,
  btcDate,
} as const;

/** Which stage a candidate is in, by the classes they have attended. */
export const IN_STAGE: Record<CandidateStage, SQL> = {
  bootcamp: not(attendedBtc),
  intermediate: and(attendedBtc, not(attendedInt))!,
};

const ON_TRACK: Record<CandidateTrack, SQL> = {
  sales: eq(e.track, "sales"),
  engineer: eq(e.track, "engineer"),
  undecided: isNull(e.track),
  deferred: eq(e.track, "deferred"),
};

/**
 * In the org, in a stage, on a track still to train or none yet, and recent
 * enough by the cutoffs. Reads `employees` and who attended what; eVals
 * scoring draws its attendees with it too.
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

/**
 * One page of candidates, in one stage and on one track when the filter
 * names them; without a track, everyone not deferred. The search matches the name, email, title or track. No
 * scores: Cohorts shows who is in them, and eVals and Reporting show how they did.
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
      site: e.site,
      reportsToEmail: e.reportsToEmail,
      reportsToName: e.reportsToName,
      startDate: e.startDate,
      activeEffectiveDate: e.activeEffectiveDate,
      track: candidateTrack,
      overridden: e.trackPinned,
      stage: candidateStage,
      recordKey: sql<string | null>`case when ${attendedBtc} then ${e.id} end`,
      btcDate,
    })
    .from(e)
    .where(
      and(
        isCandidate(cutoffs),
        filter.stage ? IN_STAGE[filter.stage] : undefined,
        filter.track ? ON_TRACK[filter.track] : or(isNull(e.track), inArray(e.track, ["sales", "engineer"])),
        searchAny(query.q, [e.fullName, e.email, e.title, candidateTrack]),
      ),
    )
    .orderBy(...orderFor(SORT_COLUMNS[query.sort], query.dir, sql`lower(${e.fullName})`, e.id))
    .limit(limit)
    .offset(offset);
  return toPage(rows, query.page);
}

/**
 * Everyone on the Current tab on the Sales or Engineer track, by stage, for
 * the Slack channel sync and the intake form's reminders: the undecided and
 * the deferred are left out. Not a
 * page, since the sync needs all of them; it is one email per candidate.
 */
export async function currentCohortEmails(): Promise<
  { email: string; fullName: string; stage: CandidateStage; track: "sales" | "engineer"; timezone: string | null; startDate: string | null }[]
> {
  const cutoffs = await getCandidateCutoffs();
  return db
    .select({
      email: sql<string>`lower(${e.email})`,
      fullName: e.fullName,
      stage: candidateStage,
      track: sql<"sales" | "engineer">`${e.track}`,
      timezone: e.timezone,
      startDate: e.startDate,
    })
    .from(e)
    .where(and(isCandidate(cutoffs), inArray(e.track, ["sales", "engineer"])));
}

/**
 * Each current-cohort candidate a Google meeting for `stage` and on `track`
 * ("both" for either) is for, with the time zone on record, null for those
 * with none: the names behind the time zone map on the Google meetings tab.
 * An Intermediate meeting is also for those in the Bootcamp stage who have
 * RSVP'd, by saving the Bootcamp intake form.
 */
export async function currentCohortPeople(
  stage: CandidateStage,
  track: "sales" | "engineer" | "both",
): Promise<{ fullName: string; timezone: string | null }[]> {
  const cutoffs = await getCandidateCutoffs();
  return db
    .select({ fullName: e.fullName, timezone: e.timezone })
    .from(e)
    .where(
      and(
        isCandidate(cutoffs),
        stage === "intermediate"
          ? or(
              IN_STAGE.intermediate,
              and(
                IN_STAGE.bootcamp,
                sql`exists (select 1 from ${intakeResponses} where ${intakeResponses.form} = 'bootcamp' and not ${intakeResponses.test} and ${intakeResponses.email} = lower(${e.email}))`,
              ),
            )
          : IN_STAGE[stage],
        track === "both" ? inArray(e.track, ["sales", "engineer"]) : eq(e.track, track),
      ),
    )
    .orderBy(sql`lower(${e.fullName})`)
    .limit(1_000);
}

/**
 * `currentCohortEmails` as a subquery to join on, one row per candidate: their
 * lowercased email as `email` and their stage as `stage`. For queries that
 * narrow something to the current cohort without fetching it first.
 */
export async function currentCohortSubquery() {
  const cutoffs = await getCandidateCutoffs();
  return db
    .select({
      email: sql<string>`lower(${e.email})`.as("cohort_email"),
      stage: candidateStage.as("cohort_stage"),
    })
    .from(e)
    .where(and(isCandidate(cutoffs), inArray(e.track, ["sales", "engineer"])))
    .as("cohort");
}

/**
 * The stage `email` is in, if they are one of `currentCohortEmails` — on the
 * Current tab on the Sales or Engineer track — else null. The intake form at
 * /intake is theirs to fill in by it.
 */
export async function cohortStageOf(email: string): Promise<CandidateStage | null> {
  const cutoffs = await getCandidateCutoffs();
  const [row] = await db
    .select({ stage: candidateStage })
    .from(e)
    .where(
      and(
        sql`lower(${e.email}) = ${email.trim().toLowerCase()}`,
        isCandidate(cutoffs),
        inArray(e.track, ["sales", "engineer"]),
      ),
    )
    .limit(1);
  return row?.stage ?? null;
}

/**
 * Everyone on the Current tab, whatever its filter, for their name cards:
 * bootcamp first, then intermediate, by name within each. Not a page, since
 * every one of them gets a card; it is one name per candidate.
 */
export async function currentCohortNames(): Promise<{ fullName: string; stage: CandidateStage }[]> {
  const cutoffs = await getCandidateCutoffs();
  return db
    .select({ fullName: e.fullName, stage: candidateStage })
    .from(e)
    .where(and(isCandidate(cutoffs), or(isNull(e.track), inArray(e.track, ["sales", "engineer"]))))
    .orderBy(candidateStage, sql`lower(${e.fullName})`, e.id);
}

/** How many are in each stage on each track, as of which sync, and the rules that drew them. */
export async function currentCohortSummary(): Promise<CurrentCohortSummary> {
  const cutoffs = await getCandidateCutoffs();
  const [cells, [synced], days, bootcampStart] = await Promise.all([
    db
      .select({ stage: candidateStage, track: candidateTrack, count: sql<number>`count(*)::int` })
      .from(e)
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
