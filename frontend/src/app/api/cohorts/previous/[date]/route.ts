/** Who attended BTC and who attended INT on one day, each side a page at a time. */

import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/api-auth";
import { getSessionDetail } from "@/lib/evals/bootcamp-history";
import { isIsoDay } from "@/lib/evals/history-values";
import { SESSION_ATTENDEE_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { canUseTraining } from "@/lib/roles";

export async function GET(req: Request, { params }: { params: Promise<{ date: string }> }) {
  const { error } = await requireCaller(req, canUseTraining);
  if (error) return error;

  const { date } = await params;
  if (!isIsoDay(date)) return NextResponse.json({ error: "invalid_date" }, { status: 400 });

  const search = new URL(req.url).searchParams;
  const detail = await getSessionDetail(date, {
    bootcamp: parseListQuery(search, SESSION_ATTENDEE_LIST, "bootcamp").page,
    intermediate: parseListQuery(search, SESSION_ATTENDEE_LIST, "intermediate").page,
  });
  if (!detail) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(detail);
}
