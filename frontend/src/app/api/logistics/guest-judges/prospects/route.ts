/** Sales and sales engineering leaders in HiBob who have never been a guest judge. */

import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/api-auth";
import { employeeSummary } from "@/lib/evals/roster";
import { JUDGE_PROSPECT_LIST } from "@/lib/list-specs";
import { listJudgeProspects } from "@/lib/logistics/guest-judges";
import { parseListQuery } from "@/lib/paging";
import { canUseTraining } from "@/lib/roles";

export async function GET(req: Request) {
  const { error } = await requireCaller(req, canUseTraining);
  if (error) return error;

  const query = parseListQuery(new URL(req.url).searchParams, JUDGE_PROSPECT_LIST);
  const [{ rows, page, hasMore }, { syncedAt }] = await Promise.all([listJudgeProspects(query), employeeSummary()]);
  return NextResponse.json({ leaders: rows, page, hasMore, syncedAt: syncedAt?.toISOString() ?? null });
}
