/** The Responses tab: every response sent to the intake form, searched and filtered by an answer. */

import { INTAKE_RESPONSE_LIST } from "@/lib/list-specs";
import { getIntakeForm } from "@/lib/logistics/intake";
import { answerFilter, listIntakeResponses } from "@/lib/logistics/responses";
import { parseListQuery } from "@/lib/paging";
import { ResponsesView } from "./responses-view";

export default async function IntakeResponsesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = parseListQuery(params, INTAKE_RESPONSE_LIST);
  const filter = answerFilter(params);
  const [form, page] = await Promise.all([getIntakeForm(), listIntakeResponses(query, filter)]);
  return <ResponsesView questions={form.questions} query={query} filter={filter} page={page} />;
}
