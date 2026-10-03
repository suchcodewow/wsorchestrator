/** The Previous tab's sessions: each day BTC or INT was held, with how many attended each, a page at a time. */

import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/api-auth";
import { listPreviousSessions, previousSessionsSummary } from "@/lib/evals/bootcamp-history";
import { PREVIOUS_SESSION_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { canUseTraining } from "@/lib/roles";

export async function GET(req: Request) {
  const { error } = await requireCaller(req, canUseTraining);
  if (error) return error;

  const query = parseListQuery(new URL(req.url).searchParams, PREVIOUS_SESSION_LIST);
  const [{ rows, page, hasMore }, summary] = await Promise.all([listPreviousSessions(query), previousSessionsSummary()]);
  return NextResponse.json({ sessions: rows, page, hasMore, total: summary.sessions, first: summary.first });
}
