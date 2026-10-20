/**
 * Reporting → Bootcamp's records: a page of the people the caller may see with
 * a BTC or INT record, with how many there are, active and inactive. An
 * Assessments Viewer gets everyone; anyone else the people below them in HiBob.
 */

import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/api-auth";
import { BOOTCAMP_RECORD_LIST, isHistoryStatus } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { bootcampRecordCounts, listBootcampRecords, readerOf } from "@/lib/reporting/bootcamp";
import { canSeeBootcampRecords } from "@/lib/roles";

export async function GET(req: Request) {
  const { error, user } = await requireCaller(req, canSeeBootcampRecords);
  if (error) return error;

  const params = new URL(req.url).searchParams;
  const status = params.get("status");
  if (status !== null && !isHistoryStatus(status)) {
    return NextResponse.json({ error: "invalid_status" }, { status: 400 });
  }

  const reader = readerOf(user);
  const query = parseListQuery(params, BOOTCAMP_RECORD_LIST);
  const [{ rows, page, hasMore }, counts] = await Promise.all([
    listBootcampRecords(reader, query, status),
    bootcampRecordCounts(reader),
  ]);
  return NextResponse.json({ people: rows, page, hasMore, status, counts });
}
