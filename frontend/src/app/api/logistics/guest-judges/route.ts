/** Everyone who has been a guest judge, on each bootcamp they judged, with the sessions they ran. */

import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/api-auth";
import { GUEST_JUDGE_LIST } from "@/lib/list-specs";
import { guestJudgeCounts, listEmptyCohorts, listGuestJudges } from "@/lib/logistics/guest-judges";
import { parseListQuery } from "@/lib/paging";
import { canUseTraining } from "@/lib/roles";

export async function GET(req: Request) {
  const { error } = await requireCaller(req, canUseTraining);
  if (error) return error;

  const query = parseListQuery(new URL(req.url).searchParams, GUEST_JUDGE_LIST);
  const [{ rows, page, hasMore }, counts, emptyCohorts] = await Promise.all([
    listGuestJudges(query),
    guestJudgeCounts(),
    listEmptyCohorts(),
  ]);
  return NextResponse.json({ judges: rows, page, hasMore, counts, emptyCohorts });
}
