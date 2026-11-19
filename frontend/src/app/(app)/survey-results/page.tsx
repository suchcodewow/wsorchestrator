/** A card for every Bootcamp's superlatives anyone has voted on, then for every daily survey anyone has answered, the latest day first. */

import { SURVEY_RESULT_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { listSuperlativeResults } from "@/lib/surveys/superlatives";
import { listSurveyResults } from "@/lib/surveys/surveys";
import { SurveyResultsView } from "./survey-results-view";

export const dynamic = "force-dynamic";

export default async function SurveyResultsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = parseListQuery(params, SURVEY_RESULT_LIST);
  const today = params.today === "1";
  const [page, superlatives] = await Promise.all([listSurveyResults(query, today), listSuperlativeResults()]);
  return <SurveyResultsView query={query} today={today} page={page} superlatives={superlatives} />;
}
