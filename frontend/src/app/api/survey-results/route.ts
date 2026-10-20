/** Survey Results: every daily survey with at least one response, a page at a time. */

import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/api-auth";
import { SURVEY_RESULT_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { canUseTraining } from "@/lib/roles";
import { listSurveyResults } from "@/lib/surveys/surveys";

export async function GET(req: Request) {
  const { error } = await requireCaller(req, canUseTraining);
  if (error) return error;

  const query = parseListQuery(new URL(req.url).searchParams, SURVEY_RESULT_LIST);
  const { rows, page, hasMore } = await listSurveyResults(query);
  return NextResponse.json({ surveys: rows, page, hasMore });
}
