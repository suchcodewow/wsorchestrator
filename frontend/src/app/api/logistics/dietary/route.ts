/** The current cohort's dietary needs, for everyone or one stage: what was marked critical, what was not, who wrote in "Other", and who has yet to register. */

import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/api-auth";
import {
  CRITICAL_WRITE_IN_PREFIX,
  UNREGISTERED_LIST,
  UNREGISTERED_PREFIX,
  WRITE_IN_LIST,
  WRITE_IN_PREFIX,
  dietaryStageOf,
} from "@/lib/list-specs";
import { dietaryCounts, listUnregistered, listWriteIns } from "@/lib/logistics/responses";
import { parseListQuery } from "@/lib/paging";
import { canUseTraining } from "@/lib/roles";

export async function GET(req: Request) {
  const { error } = await requireCaller(req, canUseTraining);
  if (error) return error;

  const params = new URL(req.url).searchParams;
  const stage = dietaryStageOf(params.get("stage"));
  const [counts, critical, other, unregistered] = await Promise.all([
    dietaryCounts(stage),
    listWriteIns(true, stage, parseListQuery(params, WRITE_IN_LIST, CRITICAL_WRITE_IN_PREFIX)),
    listWriteIns(false, stage, parseListQuery(params, WRITE_IN_LIST, WRITE_IN_PREFIX)),
    listUnregistered(parseListQuery(params, UNREGISTERED_LIST, UNREGISTERED_PREFIX), stage),
  ]);
  return NextResponse.json({
    stage,
    counts,
    criticalWriteIns: { people: critical.rows, page: critical.page, hasMore: critical.hasMore },
    otherWriteIns: { people: other.rows, page: other.page, hasMore: other.hasMore },
    unregistered: { people: unregistered.rows, page: unregistered.page, hasMore: unregistered.hasMore },
  });
}
