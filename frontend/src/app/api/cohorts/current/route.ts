/** Everyone on the Sales or Engineer track as of the last HiBob sync, a page at a time. */

import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/api-auth";
import { currentCohortSummary, listCurrentCohort } from "@/lib/evals/current-cohort";
import { CURRENT_COHORT_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { canUseTraining } from "@/lib/roles";

export async function GET(req: Request) {
  const { error } = await requireCaller(req, canUseTraining);
  if (error) return error;

  const query = parseListQuery(new URL(req.url).searchParams, CURRENT_COHORT_LIST);
  const [{ rows, page, hasMore }, { counts, syncedAt }] = await Promise.all([
    listCurrentCohort(query),
    currentCohortSummary(),
  ]);
  return NextResponse.json({ members: rows, page, hasMore, counts, syncedAt });
}
