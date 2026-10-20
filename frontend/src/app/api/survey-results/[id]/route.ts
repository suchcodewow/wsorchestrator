/** One daily survey's results: how each session was rated, and its responses a page at a time. */

import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/api-auth";
import { SURVEY_RESPONSE_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { canUseTraining } from "@/lib/roles";
import { getSurveyResult, listSurveyResponses } from "@/lib/surveys/surveys";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  const { error } = await requireCaller(req, canUseTraining);
  if (error) return error;

  const { id } = await params;
  const survey = await getSurveyResult(id);
  if (!survey) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const query = parseListQuery(new URL(req.url).searchParams, SURVEY_RESPONSE_LIST);
  const { rows, page, hasMore } = await listSurveyResponses(id, query);
  return NextResponse.json({ survey, responses: rows, page, hasMore });
}
