/** Bootcamp history, a name, email and bootcamp date per person, a page at a time, with the active and inactive counts. */

import { NextResponse } from "next/server";
import { requireEvalsViewer } from "@/lib/api-auth";
import { historyCounts, listHistoryPage } from "@/lib/evals/bootcamp-history";
import { BOOTCAMP_HISTORY_LIST, isHistoryStatus } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";

export async function GET(req: Request) {
  const { error } = await requireEvalsViewer(req);
  if (error) return error;

  const params = new URL(req.url).searchParams;
  const status = params.get("status");
  if (status !== null && !isHistoryStatus(status)) {
    return NextResponse.json({ error: "invalid_status" }, { status: 400 });
  }

  const query = parseListQuery(params, BOOTCAMP_HISTORY_LIST);
  const [{ rows, page, hasMore }, counts] = await Promise.all([listHistoryPage(query, status), historyCounts()]);
  return NextResponse.json({ history: rows, page, hasMore, status, counts });
}
