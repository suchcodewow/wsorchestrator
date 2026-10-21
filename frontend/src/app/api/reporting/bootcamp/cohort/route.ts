/**
 * Reporting → Bootcamp's current cohort: the active bootcamp, which of its
 * classes are released, and a page of the people in it the caller may see. A
 * class not yet released is empty for anyone below Assessments Viewer.
 */

import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/api-auth";
import { BOOTCAMP_COHORT_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { cohortBootcamp, listCohort, readerOf, visibleStages } from "@/lib/reporting/bootcamp";
import { canSeeBootcampRecords } from "@/lib/roles";

export async function GET(req: Request) {
  const { error, user } = await requireCaller(req, canSeeBootcampRecords);
  if (error) return error;

  const bootcamp = await cohortBootcamp();
  if (!bootcamp) return NextResponse.json({ bootcamp: null, stages: [], cohort: [], page: 1, hasMore: false });

  const reader = readerOf(user);
  const query = parseListQuery(new URL(req.url).searchParams, BOOTCAMP_COHORT_LIST);
  const { rows, page, hasMore } = await listCohort(reader, bootcamp, query);
  return NextResponse.json({ bootcamp, stages: visibleStages(reader, bootcamp), cohort: rows, page, hasMore });
}
