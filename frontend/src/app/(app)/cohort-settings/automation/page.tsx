/**
 * The Automation tab: the Organization Leader, the candidate date cutoffs and
 * the deferral window, then one search box, then the Sales, Engineer and Ignored
 * title lists. The search is shared; each list sorts and pages on its own,
 * under its own name in the URL (`sales.sort`, `engineer.page`).
 */

import { EVALS_TITLE_LISTS, type EvalsTitleList } from "@/db/schema";
import { employeeByEmail, loadRoster } from "@/lib/evals/roster";
import { getCandidateCutoffs, getDeferralDays, getOrgLeaderEmail } from "@/lib/evals/settings";
import { nextBootcampStart } from "@/lib/evals/tracks";
import { titleKey } from "@/lib/evals/title-lists";
import { listTitles, titleCounts } from "@/lib/evals/titles";
import { TITLE_LIST, type TitleSort } from "@/lib/list-specs";
import { parseListQuery, type ListQuery } from "@/lib/paging";
import { AutomationView, type ListedTitles } from "../automation-view";

export default async function AutomationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const queries = Object.fromEntries(
    EVALS_TITLE_LISTS.map((list) => [list, parseListQuery(params, TITLE_LIST, list)]),
  ) as Record<EvalsTitleList, ListQuery<TitleSort>>;

  const [pages, counts, roster, orgLeaderEmail, cutoffs, deferralDays, bootcampStart] = await Promise.all([
    Promise.all(EVALS_TITLE_LISTS.map((list) => listTitles({ ...queries[list], list }))),
    titleCounts(),
    loadRoster(),
    getOrgLeaderEmail(),
    getCandidateCutoffs(),
    getDeferralDays(),
    nextBootcampStart(),
  ]);
  const orgLeader = await employeeByEmail(orgLeaderEmail);

  const holders = new Map<string, number>();
  for (const p of roster.people) {
    if (p.title) holders.set(titleKey(p.title), (holders.get(titleKey(p.title)) ?? 0) + 1);
  }

  const lists = {} as Record<EvalsTitleList, ListedTitles>;
  EVALS_TITLE_LISTS.forEach((list, i) => {
    const page = pages[i]!;
    lists[list] = {
      query: queries[list],
      count: counts[list],
      page: {
        ...page,
        rows: page.rows.map((t) => ({
          id: t.id,
          title: t.title,
          addedBy: t.addedBy,
          holders: holders.get(titleKey(t.title)) ?? 0,
        })),
      },
    };
  });

  return (
    <AutomationView
      q={queries.sales.q}
      lists={lists}
      suggestions={roster.unlisted}
      imported={roster.employeeCount > 0}
      orgLeaderEmail={orgLeaderEmail}
      orgLeader={orgLeader}
      cutoffs={cutoffs}
      deferral={{ days: deferralDays, bootcampStart }}
    />
  );
}
