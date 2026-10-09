/**
 * The Guest judges tab: who has judged which bootcamp and the sessions they
 * ran, and the sales and sales engineering leaders HiBob has who have not
 * judged yet. The two tables share the search; each sorts and pages on its own.
 */

import { auth } from "@/auth";
import { employeeSummary } from "@/lib/evals/roster";
import { GUEST_JUDGE_LIST, JUDGE_PROSPECT_LIST } from "@/lib/list-specs";
import { guestJudgeCounts, listEmptyCohorts, listGuestJudges, listJudgeProspects } from "@/lib/logistics/guest-judges";
import { parseListQuery } from "@/lib/paging";
import { canManageTrainingSettings } from "@/lib/roles";
import { PROSPECTS, isProspectGroup } from "@/lib/logistics/guest-judge-values";
import { GuestJudgesView } from "./guest-judges-view";

export default async function GuestJudgesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const judgeQuery = parseListQuery(params, GUEST_JUDGE_LIST);
  const prospectQuery = parseListQuery(params, JUDGE_PROSPECT_LIST, PROSPECTS);
  // A hand-typed group that isn't one shows every leader, as a bad sort does.
  const asked = params[`${PROSPECTS}.group`];
  const prospectGroup = isProspectGroup(asked) ? asked : null;
  const [session, judges, prospects, counts, { syncedAt }, emptyCohorts] = await Promise.all([
    auth(),
    listGuestJudges(judgeQuery),
    listJudgeProspects(prospectQuery, prospectGroup),
    guestJudgeCounts(),
    employeeSummary(),
    listEmptyCohorts(),
  ]);
  return (
    <GuestJudgesView
      judgeQuery={judgeQuery}
      judges={judges}
      prospectQuery={prospectQuery}
      prospects={prospects}
      prospectGroup={prospectGroup}
      counts={counts}
      emptyCohorts={emptyCohorts}
      syncedAt={syncedAt?.toISOString() ?? null}
      canEdit={!!session?.user && canManageTrainingSettings(session.user.access)}
    />
  );
}
