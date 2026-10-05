/** One active assessment's attendees, a page at a time, with their scores at the active bootcamp. */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCaller } from "@/lib/api-auth";
import { attendeeCounts, breakoutRooms, listAttendees, scoringAssessment, scoringBootcamp } from "@/lib/evals/scoring";
import { ASSESSMENT_ATTENDEE_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { canScoreAssessments } from "@/lib/roles";

export async function GET(req: Request, { params }: { params: Promise<{ assessmentId: string }> }) {
  const { error, user } = await requireCaller(req, canScoreAssessments);
  if (error) return error;

  const id = z.string().uuid().safeParse((await params).assessmentId);
  const assessment = id.success ? await scoringAssessment(id.data) : null;
  if (!assessment) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const bootcamp = await scoringBootcamp(assessment.stage);
  const search = new URL(req.url).searchParams;
  const asked = search.get("mine");
  if (asked !== null && asked !== "1") return NextResponse.json({ error: "invalid" }, { status: 400 });
  const query = parseListQuery(search, ASSESSMENT_ATTENDEE_LIST);
  const mine = asked === "1" && user.email ? user.email : null;
  const [{ rows, page, hasMore }, counts, rooms] = await Promise.all([
    listAttendees(assessment, bootcamp?.id ?? null, query, mine),
    attendeeCounts(assessment, bootcamp?.id ?? null, user.email),
    breakoutRooms(assessment, bootcamp?.id ?? null, user.email),
  ]);
  return NextResponse.json({ assessment, bootcamp, ...counts, rooms, people: rows, page, hasMore });
}
