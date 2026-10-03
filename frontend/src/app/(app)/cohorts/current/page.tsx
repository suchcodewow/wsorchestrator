/** The Current tab: the bootcamp and intermediate candidates, each a page at a time. */

import { auth } from "@/auth";
import { CANDIDATE_STAGES, currentCohortSummary, listCurrentCohort } from "@/lib/evals/current-cohort";
import { CURRENT_COHORT_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { canManageTrainingSettings } from "@/lib/roles";
import { activeBootcamp } from "@/lib/scheduler/bootcamps";
import { CurrentCohortView } from "./current-view";

export default async function CurrentCohortPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const [bootcampQuery, intermediateQuery] = CANDIDATE_STAGES.map((stage) =>
    parseListQuery(params, CURRENT_COHORT_LIST, stage),
  );
  const [session, bootcampPage, intermediatePage, summary, active] = await Promise.all([
    auth(),
    listCurrentCohort("bootcamp", bootcampQuery!),
    listCurrentCohort("intermediate", intermediateQuery!),
    currentCohortSummary(),
    activeBootcamp(),
  ]);
  return (
    <CurrentCohortView
      stages={{
        bootcamp: { query: bootcampQuery!, page: bootcampPage },
        intermediate: { query: intermediateQuery!, page: intermediatePage },
      }}
      counts={summary.counts}
      syncedAt={summary.syncedAt?.toISOString() ?? null}
      cutoffs={summary.cutoffs}
      activeBootcamp={active}
      canSort={session?.user ? canManageTrainingSettings(session.user.access) : false}
    />
  );
}
