/** The Current tab: everyone on the Sales or Engineer track, a page at a time. */

import { currentCohortSummary, listCurrentCohort } from "@/lib/evals/current-cohort";
import { CURRENT_COHORT_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { CurrentCohortView } from "./current-view";

export default async function CurrentCohortPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = parseListQuery(await searchParams, CURRENT_COHORT_LIST);
  const [page, summary] = await Promise.all([listCurrentCohort(query), currentCohortSummary()]);
  return (
    <CurrentCohortView
      query={query}
      page={page}
      counts={summary.counts}
      syncedAt={summary.syncedAt?.toISOString() ?? null}
    />
  );
}
