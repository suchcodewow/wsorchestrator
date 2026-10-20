/** One daily survey's results: how each session was rated, and every response. */

import { notFound } from "next/navigation";
import { SURVEY_RESPONSE_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { getSurveyResult, listSurveyResponses } from "@/lib/surveys/surveys";
import { SurveyResultView } from "./survey-result-view";

export const dynamic = "force-dynamic";

export default async function SurveyResultPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const survey = await getSurveyResult((await params).id);
  if (!survey) notFound();
  const query = parseListQuery(await searchParams, SURVEY_RESPONSE_LIST);
  return <SurveyResultView survey={survey} query={query} page={await listSurveyResponses(survey.id, query)} />;
}
