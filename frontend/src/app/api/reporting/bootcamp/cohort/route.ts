/**
 * Reporting → Bootcamp's current cohort: the active bootcamp, which of its
 * classes are released, and a page of the people in it the caller may see,
 * of one class with `stage`. A class not yet released is empty for anyone
 * below Assessments Viewer.
 */

import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/api-auth";
import { BOOTCAMP_COHORT_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { cohortBootcamp, cohortCounts, listCohort, readerOf, visibleStages } from "@/lib/reporting/bootcamp";
import { isReleaseStage } from "@/lib/reporting/bootcamp-values";
import { canSeeBootcampRecords } from "@/lib/roles";

export async function GET(req: Request) {
  const { error, user } = await requireCaller(req, canSeeBootcampRecords);
  if (error) return error;

  const params = new URL(req.url).searchParams;
  const stage = params.get("stage");
  if (stage !== null && !isReleaseStage(stage)) {
    return NextResponse.json({ error: "invalid_stage" }, { status: 400 });
  }

  const bootcamp = await cohortBootcamp();
  if (!bootcamp) {
    return NextResponse.json({
      bootcamp: null,
      stages: [],
      stage,
      counts: { bootcamp: 0, intermediate: 0 },
      cohort: [],
      page: 1,
      hasMore: false,
    });
  }

  const reader = readerOf(user);
  const query = parseListQuery(params, BOOTCAMP_COHORT_LIST);
  const [{ rows, page, hasMore }, counts] = await Promise.all([
    listCohort(reader, bootcamp, query, stage),
    cohortCounts(reader, bootcamp),
  ]);
  return NextResponse.json({ bootcamp, stages: visibleStages(reader, bootcamp), stage, counts, cohort: rows, page, hasMore });
}
