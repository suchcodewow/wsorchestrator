/** The Current tab's candidates, a page at a time, narrowed to a stage and a track, with each one's count and the active bootcamp. */

import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/api-auth";
import {
  currentCohortSummary,
  isCandidateStage,
  isCandidateTrack,
  listCurrentCohort,
} from "@/lib/evals/current-cohort";
import { CURRENT_COHORT_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { canUseTraining } from "@/lib/roles";
import { activeBootcamp } from "@/lib/scheduler/bootcamps";

export async function GET(req: Request) {
  const { error } = await requireCaller(req, canUseTraining);
  if (error) return error;

  const params = new URL(req.url).searchParams;
  const stage = params.get("stage");
  if (stage !== null && !isCandidateStage(stage)) return NextResponse.json({ error: "invalid_stage" }, { status: 400 });
  const track = params.get("track");
  if (track !== null && !isCandidateTrack(track)) return NextResponse.json({ error: "invalid_track" }, { status: 400 });

  const query = parseListQuery(params, CURRENT_COHORT_LIST);
  const [{ rows, page, hasMore }, { counts, syncedAt, cutoffs, deferral }, bootcamp] = await Promise.all([
    listCurrentCohort({ stage, track }, query),
    currentCohortSummary(),
    activeBootcamp(),
  ]);
  return NextResponse.json({
    stage,
    track,
    members: rows,
    page,
    hasMore,
    counts,
    syncedAt,
    cutoffs,
    deferral,
    activeBootcamp: bootcamp,
  });
}
