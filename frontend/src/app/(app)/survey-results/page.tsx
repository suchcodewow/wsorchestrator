/** A card for every daily survey anyone has answered, the latest day first. */

import { SURVEY_RESULT_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { listSurveyResults } from "@/lib/surveys/surveys";
import { SurveyResultsView } from "./survey-results-view";

export const dynamic = "force-dynamic";

export default async function SurveyResultsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = parseListQuery(await searchParams, SURVEY_RESULT_LIST);
  return <SurveyResultsView query={query} page={await listSurveyResults(query)} />;
}
