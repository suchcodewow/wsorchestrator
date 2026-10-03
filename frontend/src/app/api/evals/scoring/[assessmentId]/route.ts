/** One active assessment's attendees, a page at a time, with their scores at the active bootcamp. */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCaller } from "@/lib/api-auth";
import { attendeeCounts, listAttendees, scoringAssessment, scoringBootcamp } from "@/lib/evals/scoring";
import { ASSESSMENT_ATTENDEE_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { canScoreAssessments } from "@/lib/roles";

export async function GET(req: Request, { params }: { params: Promise<{ assessmentId: string }> }) {
  const { error } = await requireCaller(req, canScoreAssessments);
  if (error) return error;

  const id = z.string().uuid().safeParse((await params).assessmentId);
  const assessment = id.success ? await scoringAssessment(id.data) : null;
  if (!assessment) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const bootcamp = await scoringBootcamp(assessment.stage);
  const query = parseListQuery(new URL(req.url).searchParams, ASSESSMENT_ATTENDEE_LIST);
  const [{ rows, page, hasMore }, counts] = await Promise.all([
    listAttendees(assessment, bootcamp?.id ?? null, query),
    attendeeCounts(assessment, bootcamp?.id ?? null),
  ]);
  return NextResponse.json({ assessment, bootcamp, ...counts, people: rows, page, hasMore });
}
