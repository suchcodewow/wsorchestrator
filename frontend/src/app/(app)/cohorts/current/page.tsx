/** The Current tab: the bootcamp and intermediate candidates not deferred, in one table, narrowed by stage and track, a page at a time. */

import { auth } from "@/auth";
import {
  cohortScoring,
  currentCohortSummary,
  isCandidateStage,
  isCurrentTrack,
  listCurrentCohort,
} from "@/lib/evals/current-cohort";
import { CURRENT_COHORT_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { getTestGroup } from "@/lib/cohorts/test-group";
import {
  canManageTestGroup,
  canManageTrainingSettings,
  canUseEvals,
} from "@/lib/roles";
import { activeBootcamp } from "@/lib/scheduler/bootcamps";
import { CurrentCohortView } from "./current-view";
import { TestGroupPanel } from "./test-group-panel";

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
    track: isCurrentTrack(params.track) ? params.track : null,
  };
  const session = await auth();
  const canSeeScores = session?.user ? canUseEvals(session.user.access) : false;
  const scoring = canSeeScores
    ? { scoring: await cohortScoring(filter) }
    : undefined;
  const [page, summary, active, testGroup] = await Promise.all([
    listCurrentCohort(filter, query, scoring),
    currentCohortSummary(),
    activeBootcamp(),
    getTestGroup(),
  ]);
  return (
    <div className="space-y-4">
      <TestGroupPanel
        group={testGroup}
        canManage={
          session?.user ? canManageTestGroup(session.user.access) : false
        }
      />
      <CurrentCohortView
        tab="current"
        query={query}
        filter={filter}
        page={page}
        counts={summary.counts}
        assessments={scoring?.scoring?.assessments ?? null}
        deferral={summary.deferral}
        activeBootcamp={active}
        canSetTrack={
          session?.user ? canManageTrainingSettings(session.user.access) : false
        }
        canSeeScores={canSeeScores}
      />
    </div>
  );
}
