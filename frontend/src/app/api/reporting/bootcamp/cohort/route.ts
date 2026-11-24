/**
 * Reporting → Live Sessions' class still being judged: the cohort bootcamp,
 * which of its classes are released, and a page of the people in those not
 * yet released, of one class with `stage`. Only an Assessments Viewer sees
 * anyone in it; a released class's people are its graduates, on
 * GET /api/reporting/bootcamp.
 */

import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/api-auth";
import { BOOTCAMP_COHORT_LIST, isTrackFilter } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { classStages, cohortBootcamp, cohortCounts, listCohort, readerOf } from "@/lib/reporting/bootcamp";
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

  const track = params.get("track");
  if (track !== null && !isTrackFilter(track)) {
    return NextResponse.json({ error: "invalid_track" }, { status: 400 });
  }

  const bootcamp = await cohortBootcamp();
  if (!bootcamp) {
    return NextResponse.json({
      bootcamp: null,
      stages: [],
      stage,
      track,
      counts: { bootcamp: 0, intermediate: 0 },
      cohort: [],
      page: 1,
      hasMore: false,
    });
  }

  const reader = readerOf(user);
  const query = parseListQuery(params, BOOTCAMP_COHORT_LIST);
  const [{ rows, page, hasMore }, counts] = await Promise.all([
    listCohort(reader, bootcamp, query, stage, track),
    cohortCounts(reader, bootcamp),
  ]);
  return NextResponse.json({ bootcamp, stages: classStages(reader, bootcamp), stage, track, counts, cohort: rows, page, hasMore });
}
