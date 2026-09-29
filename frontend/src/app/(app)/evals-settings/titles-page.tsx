/** What the three title tabs share: one list's titles, and the org's unlisted ones. */

import type { EvalsTitleList } from "@/db/schema";
import { loadRoster } from "@/lib/evals/roster";
import { titleKey } from "@/lib/evals/title-lists";
import { listTitles } from "@/lib/evals/titles";
import { TitlesView } from "./titles-view";

export async function TitlesPage({ list }: { list: EvalsTitleList }) {
  const [titles, roster] = await Promise.all([listTitles(), loadRoster()]);

  const holders = new Map<string, number>();
  for (const p of roster.people) {
    if (p.title) holders.set(titleKey(p.title), (holders.get(titleKey(p.title)) ?? 0) + 1);
  }

  return (
    <TitlesView
      list={list}
      titles={titles
        .filter((t) => t.list === list)
        .map((t) => ({
          id: t.id,
          title: t.title,
          addedBy: t.addedBy,
          holders: holders.get(titleKey(t.title)) ?? 0,
        }))}
      suggestions={roster.unlisted}
      imported={roster.employeeCount > 0}
    />
  );
}
