/** The Content tab: every item the library shows and the coach serves, a page at a time. */

import { notFound } from "next/navigation";
import { MIMIR_ITEM_LIST } from "@/lib/list-specs";
import { itemCount, listItems } from "@/lib/mimir/items";
import { readItemFilter } from "@/lib/mimir/kinds";
import { parseListQuery } from "@/lib/paging";
import { ContentView } from "./content-view";

export default async function ContentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const read = readItemFilter(params);
  if ("error" in read) notFound();
  const kind = read.filter.kind ?? null;

  const query = parseListQuery(params, MIMIR_ITEM_LIST);
  const [page, count] = await Promise.all([listItems(query, kind ? { kind } : {}), itemCount()]);
  return (
    <ContentView
      query={query}
      kind={kind}
      count={count}
      page={{
        ...page,
        rows: page.rows.map((r) => ({
          id: r.id,
          kind: r.kind,
          parentId: r.parentId,
          position: r.position,
          title: r.title,
          emoji: r.emoji,
          updatedAt: r.updatedAt.toISOString(),
        })),
      }}
    />
  );
}
