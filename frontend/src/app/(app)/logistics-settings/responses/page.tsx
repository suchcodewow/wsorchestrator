/** The Responses tab: each person's latest answers to one intake form, or to both, searched and filtered by an answer. */

import { INTAKE_RESPONSE_LIST } from "@/lib/list-specs";
import { getIntakeForm } from "@/lib/logistics/intake";
import { questionsOfBoth, responsesFormOf } from "@/lib/logistics/intake-values";
import { answerFilter, listIntakeResponses } from "@/lib/logistics/responses";
import { parseListQuery } from "@/lib/paging";
import { ResponsesView } from "./responses-view";

export default async function IntakeResponsesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const form = responsesFormOf(params.form);
  const query = parseListQuery(params, INTAKE_RESPONSE_LIST);
  const filter = answerFilter(params);
  const [bootcamp, intermediate, page] = await Promise.all([
    getIntakeForm("bootcamp"),
    getIntakeForm("intermediate"),
    listIntakeResponses(form === "all" ? null : form, query, filter),
  ]);
  const byForm = { bootcamp: bootcamp.questions, intermediate: intermediate.questions };
  const questions = form === "all" ? questionsOfBoth(byForm.bootcamp, byForm.intermediate) : byForm[form];
  return <ResponsesView form={form} questions={questions} questionsByForm={byForm} query={query} filter={filter} page={page} />;
}
