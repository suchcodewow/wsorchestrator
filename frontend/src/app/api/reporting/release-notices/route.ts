/** The log of release messages, a page at a time: each Release of BTC or INT scores, and each Preview of one. */

import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/api-auth";
import { RELEASE_NOTICE_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { listReleaseNotices } from "@/lib/reporting/release-notice";
import { canManageBootcampRecords } from "@/lib/roles";

export async function GET(req: Request) {
  const { error } = await requireCaller(req, canManageBootcampRecords);
  if (error) return error;

  const { rows, page, hasMore } = await listReleaseNotices(parseListQuery(new URL(req.url).searchParams, RELEASE_NOTICE_LIST));
  return NextResponse.json({ runs: rows, page, hasMore });
}
