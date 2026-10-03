/**
 * The Cohorts page's Current tab: the org members still to train. Someone
 * with no BTC date is a bootcamp candidate; someone with a BTC date and no
 * INT date is an intermediate candidate. Anyone on the ignored or exempt
 * track is left out; a title on no list is listed as undecided until someone
 * sorts it. Read from `employees.track`, so it is as fresh as the last sync
 * or the last title sorted, whichever came later.
 */

import "server-only";

import { and, inArray, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { bootcampHistory, employees, type Employee } from "@/db/schema";
import type { CurrentCohortSort } from "@/lib/list-specs";
import { pageWindow, toPage, type ListQuery, type Page } from "@/lib/paging";
import { blankAsNull, orderFor, searchAny } from "@/lib/paging-sql";

export const CANDIDATE_STAGES = ["bootcamp", "intermediate"] as const;
export type CandidateStage = (typeof CANDIDATE_STAGES)[number];

export function isCandidateStage(value: unknown): value is CandidateStage {
  return CANDIDATE_STAGES.includes(value as CandidateStage);
}

/** A candidate's track: `undecided` for a title on no list. */
export type CandidateTrack = "sales" | "engineer" | "undecided";

export type CurrentCohortMember = Pick<
  Employee,
  "email" | "fullName" | "title" | "department" | "reportsToEmail" | "reportsToName"
> & {
  track: CandidateTrack;
  /** When they passed bootcamp; null for a bootcamp candidate. */
  btcDate: string | null;
};

export type CurrentCohortSummary = {
  /** Everyone in each stage, and everyone undecided across both, whatever the search. */
  counts: Record<CandidateStage | "undecided", number>;
  /** When the sync that set those tracks ran; null if none has stored anyone. */
  syncedAt: Date | null;
};

const e = employees;
const h = bootcampHistory;

const candidateTrack = sql<CandidateTrack>`coalesce(${e.track}, 'undecided')`;

const SORT_COLUMNS = {
  fullName: sql`lower(${e.fullName})`,
  email: e.email,
  title: sql`lower(${blankAsNull(e.title)})`,
  department: sql`lower(${blankAsNull(e.department)})`,
  reportsToName: sql`lower(coalesce(${blankAsNull(e.reportsToName)}, ${blankAsNull(e.reportsToEmail)}))`,
  track: candidateTrack,
  btcDate: h.btcDate,
} as const;

/** In the org, and on a track still to train or none yet. */
const isCandidate = and(isNotNull(e.orgDepth), or(isNull(e.track), inArray(e.track, ["sales", "engineer"])));

const IN_STAGE: Record<CandidateStage, SQL> = {
  bootcamp: isNull(h.btcDate),
  intermediate: and(isNotNull(h.btcDate), isNull(h.intDate))!,
};

/** One page of one stage's candidates. The search matches the name, email, title, department, manager or track. */
export async function listCurrentCohort(
  stage: CandidateStage,
  query: ListQuery<CurrentCohortSort>,
): Promise<Page<CurrentCohortMember>> {
  const { limit, offset } = pageWindow(query.page);
  const rows = await db
    .select({
      email: e.email,
      fullName: e.fullName,
      title: e.title,
      department: e.department,
      reportsToEmail: e.reportsToEmail,
      reportsToName: e.reportsToName,
      track: candidateTrack,
      btcDate: h.btcDate,
    })
    .from(e)
    .leftJoin(h, sql`${h.email} = ${e.email}`)
    .where(
      and(
        isCandidate,
        IN_STAGE[stage],
        searchAny(query.q, [e.fullName, e.email, e.title, e.department, e.reportsToName, e.reportsToEmail, candidateTrack]),
      ),
    )
    .orderBy(...orderFor(SORT_COLUMNS[query.sort], query.dir, sql`lower(${e.fullName})`, e.id))
    .limit(limit)
    .offset(offset);
  return toPage(rows, query.page);
}

/** How many are in each stage and undecided, and as of which sync. */
export async function currentCohortSummary(): Promise<CurrentCohortSummary> {
  const [[counts], [synced]] = await Promise.all([
    db
      .select({
        bootcamp: sql<number>`count(*) filter (where ${IN_STAGE.bootcamp})::int`,
        intermediate: sql<number>`count(*) filter (where ${IN_STAGE.intermediate})::int`,
        undecided: sql<number>`count(*) filter (where ${e.track} is null and (${IN_STAGE.bootcamp} or ${IN_STAGE.intermediate}))::int`,
      })
      .from(e)
      .leftJoin(h, sql`${h.email} = ${e.email}`)
      .where(isCandidate),
    // A sync stamps every row with the same time.
    db.select({ at: sql<string | null>`max(${e.importedAt})` }).from(e),
  ]);
  return {
    counts: {
      bootcamp: counts?.bootcamp ?? 0,
      intermediate: counts?.intermediate ?? 0,
      undecided: counts?.undecided ?? 0,
    },
    syncedAt: synced?.at ? new Date(synced.at) : null,
  };
}
