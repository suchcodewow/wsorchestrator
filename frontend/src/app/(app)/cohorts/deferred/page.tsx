/** The Deferred tab: the bootcamp and intermediate candidates deferred to a later bootcamp, narrowed by stage, a page at a time. */

import { auth } from "@/auth";
import { currentCohortSummary, isCandidateStage, listCurrentCohort } from "@/lib/evals/current-cohort";
import { CURRENT_COHORT_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { canManageTrainingSettings, canUseEvals } from "@/lib/roles";
import { activeBootcamp } from "@/lib/scheduler/bootcamps";
import { CurrentCohortView } from "../current/current-view";

export default async function DeferredCohortPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = parseListQuery(params, CURRENT_COHORT_LIST);
  // A hand-typed stage that isn't one shows both, as a bad sort does.
  const filter = { stage: isCandidateStage(params.stage) ? params.stage : null, track: "deferred" as const };
  const session = await auth();
  const canSeeScores = session?.user ? canUseEvals(session.user.access) : false;
  const [page, summary, active] = await Promise.all([
    listCurrentCohort(filter, query, canSeeScores ? { scoring: null } : undefined),
    currentCohortSummary(),
    activeBootcamp(),
  ]);
  return (
    <CurrentCohortView
      tab="deferred"
      query={query}
      filter={filter}
      page={page}
      counts={summary.counts}
      assessments={null}
      deferral={summary.deferral}
      activeBootcamp={active}
      canSetTrack={session?.user ? canManageTrainingSettings(session.user.access) : false}
      canSeeScores={canSeeScores}
    />
  );
}
