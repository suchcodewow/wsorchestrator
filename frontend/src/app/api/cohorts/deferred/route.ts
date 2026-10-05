/**
 * The Deferred tab's candidates, a page at a time, narrowed to a stage, with
 * each stage's count, the deferral window and the active bootcamp. A caller
 * in eVals also gets each one's BTC score.
 */

import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/api-auth";
import { currentCohortSummary, isCandidateStage, listCurrentCohort } from "@/lib/evals/current-cohort";
import { CURRENT_COHORT_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { canUseEvals, canUseTraining } from "@/lib/roles";
import { activeBootcamp } from "@/lib/scheduler/bootcamps";

export async function GET(req: Request) {
  const { error, user } = await requireCaller(req, canUseTraining);
  if (error) return error;

  const params = new URL(req.url).searchParams;
  const stage = params.get("stage");
  if (stage !== null && !isCandidateStage(stage)) return NextResponse.json({ error: "invalid_stage" }, { status: 400 });

  const query = parseListQuery(params, CURRENT_COHORT_LIST);
  // No assessment is set for the deferred track, so there are never score columns.
  const scoring = canUseEvals(user.access) ? { scoring: null } : undefined;
  const [{ rows, page, hasMore }, { counts, syncedAt, cutoffs, deferral }, bootcamp] = await Promise.all([
    listCurrentCohort({ stage, track: "deferred" }, query, scoring),
    currentCohortSummary(),
    activeBootcamp(),
  ]);
  return NextResponse.json({
    stage,
    members: rows,
    page,
    hasMore,
    counts: { bootcamp: counts.bootcamp.deferred, intermediate: counts.intermediate.deferred },
    syncedAt,
    cutoffs,
    deferral,
    activeBootcamp: bootcamp,
  });
}
