/** The Automation tab: one search box, then the Sales, Engineer and Ignored title lists. */

import { EVALS_TITLE_LISTS, type EvalsTitleList } from "@/db/schema";
import { listEmployees, loadRoster } from "@/lib/evals/roster";
import { getOrgLeaderEmail } from "@/lib/evals/settings";
import { titleKey } from "@/lib/evals/title-lists";
import { listTitles } from "@/lib/evals/titles";
import { AutomationView, type ListedTitle } from "../automation-view";

export default async function AutomationPage() {
  const [titles, roster, { people: employees }, orgLeaderEmail] = await Promise.all([
    listTitles(),
    loadRoster(),
    listEmployees(),
    getOrgLeaderEmail(),
  ]);

  const holders = new Map<string, number>();
  for (const p of roster.people) {
    if (p.title) holders.set(titleKey(p.title), (holders.get(titleKey(p.title)) ?? 0) + 1);
  }

  const byList = {} as Record<EvalsTitleList, ListedTitle[]>;
  for (const list of EVALS_TITLE_LISTS) {
    byList[list] = titles
      .filter((t) => t.list === list)
      .map((t) => ({
        id: t.id,
        title: t.title,
        addedBy: t.addedBy,
        holders: holders.get(titleKey(t.title)) ?? 0,
      }));
  }

  return (
    <AutomationView
      titles={byList}
      suggestions={roster.unlisted}
      imported={roster.employeeCount > 0}
      employees={employees.map((e) => ({ email: e.email, fullName: e.fullName }))}
      orgLeaderEmail={orgLeaderEmail}
    />
  );
}
