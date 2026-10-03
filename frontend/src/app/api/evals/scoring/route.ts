/** The active assessments for one stage, a page at a time, and the bootcamp they would be scored at. */

import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/api-auth";
import { listAssessments } from "@/lib/evals/assessments";
import { isCandidateStage } from "@/lib/evals/current-cohort";
import { scoringBootcamp } from "@/lib/evals/scoring";
import { ASSESSMENT_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { canScoreAssessments } from "@/lib/roles";

export async function GET(req: Request) {
  const { error } = await requireCaller(req, canScoreAssessments);
  if (error) return error;

  const params = new URL(req.url).searchParams;
  const stage = params.get("stage");
  if (!isCandidateStage(stage)) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const query = parseListQuery(params, ASSESSMENT_LIST);
  const [{ rows, page, hasMore }, bootcamp] = await Promise.all([
    listAssessments(query, { stage, active: true }),
    scoringBootcamp(stage),
  ]);
  return NextResponse.json({ stage, bootcamp, assessments: rows, page, hasMore });
}
