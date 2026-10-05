/** The Current tab: the bootcamp and intermediate candidates in one table, narrowed by stage and track, a page at a time. */

import { auth } from "@/auth";
import { currentCohortSummary, isCandidateStage, isCandidateTrack, listCurrentCohort } from "@/lib/evals/current-cohort";
import { CURRENT_COHORT_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { canManageTrainingSettings, canUseEvals } from "@/lib/roles";
import { activeBootcamp } from "@/lib/scheduler/bootcamps";
import { CurrentCohortView } from "./current-view";

export default async function CurrentCohortPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = parseListQuery(params, CURRENT_COHORT_LIST);
  // A hand-typed filter that isn't one shows everyone, as a bad sort does.
  const filter = {
    stage: isCandidateStage(params.stage) ? params.stage : null,
    track: isCandidateTrack(params.track) ? params.track : null,
  };
  const [session, page, summary, active] = await Promise.all([
    auth(),
    listCurrentCohort(filter, query),
    currentCohortSummary(),
    activeBootcamp(),
  ]);
  return (
    <CurrentCohortView
      query={query}
      filter={filter}
      page={page}
      counts={summary.counts}
      syncedAt={summary.syncedAt?.toISOString() ?? null}
      cutoffs={summary.cutoffs}
      deferral={summary.deferral}
      activeBootcamp={active}
      canSetTrack={session?.user ? canManageTrainingSettings(session.user.access) : false}
      canOpenHistory={session?.user ? canUseEvals(session.user.access) : false}
    />
  );
}
