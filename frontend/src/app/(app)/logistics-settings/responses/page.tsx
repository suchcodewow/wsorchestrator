/** The Responses tab: each person's latest answers to one intake form, searched and filtered by an answer. */

import { INTAKE_RESPONSE_LIST } from "@/lib/list-specs";
import { getIntakeForm } from "@/lib/logistics/intake";
import { isIntakeFormId } from "@/lib/logistics/intake-values";
import { answerFilter, listIntakeResponses } from "@/lib/logistics/responses";
import { parseListQuery } from "@/lib/paging";
import { ResponsesView } from "./responses-view";

export default async function IntakeResponsesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const form = isIntakeFormId(params.form) ? params.form : "bootcamp";
  const query = parseListQuery(params, INTAKE_RESPONSE_LIST);
  const filter = answerFilter(params);
  const [{ questions }, page] = await Promise.all([getIntakeForm(form), listIntakeResponses(form, query, filter)]);
  return <ResponsesView form={form} questions={questions} query={query} filter={filter} page={page} />;
}
