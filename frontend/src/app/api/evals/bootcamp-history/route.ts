/** Bootcamp history, a name and email per person, a page at a time. */

import { NextResponse } from "next/server";
import { requireEvalsViewer } from "@/lib/api-auth";
import { historyCount, listHistoryPage } from "@/lib/evals/bootcamp-history";
import { BOOTCAMP_HISTORY_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";

export async function GET(req: Request) {
  const { error } = await requireEvalsViewer(req);
  if (error) return error;

  const query = parseListQuery(new URL(req.url).searchParams, BOOTCAMP_HISTORY_LIST);
  const [{ rows, page, hasMore }, total] = await Promise.all([listHistoryPage(query), historyCount()]);
  return NextResponse.json({ history: rows, page, hasMore, total });
}
