/** The Assessments tab: everything attendees can be scored on, a page at a time. */

import { assessmentCount, listAssessments } from "@/lib/evals/assessments";
import { ASSESSMENT_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { AssessmentsView } from "./assessments-view";

export default async function AssessmentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = parseListQuery(await searchParams, ASSESSMENT_LIST);
  const [page, count] = await Promise.all([listAssessments(query), assessmentCount()]);
  return (
    <AssessmentsView
      query={query}
      page={{ ...page, rows: page.rows.map((a) => ({ ...a, updatedAt: a.updatedAt.toISOString() })) }}
      count={count}
    />
  );
}
