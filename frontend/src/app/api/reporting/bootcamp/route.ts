/**
 * Reporting → Live Sessions' table: a page of the people the caller may see
 * with a BTC or INT record, as the page narrows it, with how many there are,
 * active and inactive, and how many graduated from the latest released
 * bootcamp. An Assessments Viewer gets everyone, and can ask for the class
 * still being judged; anyone else the people below them in HiBob.
 */

import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/api-auth";
import { BOOTCAMP_RECORD_LIST, isHistoryStatus, isLiveSessionsShow, isTrackFilter } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { bootcampRecordCounts, listLiveSessions, liveSessionsContext, liveSessionsFilters, readerOf } from "@/lib/reporting/bootcamp";
import { isReleaseStage } from "@/lib/reporting/bootcamp-values";
import { canSeeBootcampRecords } from "@/lib/roles";

export async function GET(req: Request) {
  const { error, user } = await requireCaller(req, canSeeBootcampRecords);
  if (error) return error;

  const params = new URL(req.url).searchParams;
  const show = params.get("show");
  if (show !== null && !isLiveSessionsShow(show)) {
    return NextResponse.json({ error: "invalid_show" }, { status: 400 });
  }

  const stage = params.get("stage");
  if (stage !== null && !isReleaseStage(stage)) {
    return NextResponse.json({ error: "invalid_stage" }, { status: 400 });
  }

  const status = params.get("status");
  if (status !== null && !isHistoryStatus(status)) {
    return NextResponse.json({ error: "invalid_status" }, { status: 400 });
  }

  const track = params.get("track");
  if (track !== null && !isTrackFilter(track)) {
    return NextResponse.json({ error: "invalid_track" }, { status: 400 });
  }

  const reader = readerOf(user);
  const query = parseListQuery(params, BOOTCAMP_RECORD_LIST);
  const context = await liveSessionsContext(reader);
  const filters = liveSessionsFilters(context, (name) => params.get(name));
  const [{ rows, page, hasMore }, counts] = await Promise.all([
    listLiveSessions(reader, context, filters, query),
    bootcampRecordCounts(reader),
  ]);
  return NextResponse.json({
    people: rows,
    page,
    hasMore,
    ...filters,
    graduates: context.graduates && { startDate: context.graduates.startDate, stages: context.graduates.stages },
    class: context.class && { startDate: context.class.bootcamp.startDate, stages: context.class.stages },
    counts,
  });
}
