/** One stage of the Current tab's candidates, a page at a time, with each stage's count and the active bootcamp. */

import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/api-auth";
import { currentCohortSummary, isCandidateStage, listCurrentCohort } from "@/lib/evals/current-cohort";
import { CURRENT_COHORT_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { canUseTraining } from "@/lib/roles";
import { activeBootcamp } from "@/lib/scheduler/bootcamps";

export async function GET(req: Request) {
  const { error } = await requireCaller(req, canUseTraining);
  if (error) return error;

  const params = new URL(req.url).searchParams;
  const asked = params.get("stage") ?? "bootcamp";
  if (!isCandidateStage(asked)) return NextResponse.json({ error: "invalid_stage" }, { status: 400 });

  const query = parseListQuery(params, CURRENT_COHORT_LIST);
  const [{ rows, page, hasMore }, { counts, syncedAt, cutoffs }, bootcamp] = await Promise.all([
    listCurrentCohort(asked, query),
    currentCohortSummary(),
    activeBootcamp(),
  ]);
  return NextResponse.json({ stage: asked, members: rows, page, hasMore, counts, syncedAt, cutoffs, activeBootcamp: bootcamp });
}
