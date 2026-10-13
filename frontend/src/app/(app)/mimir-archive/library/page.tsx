/** The library: one kind of item at a time, as cards, with how far the reader has got with each. */

import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import type { MimirAttrs, MimirKind } from "@/db/schema";
import { MIMIR_ITEM_LIST } from "@/lib/list-specs";
import { renderMarkdown } from "@/lib/markdown";
import { getItem, itemCount, listItems, type ItemSummary } from "@/lib/mimir/items";
import { LIBRARY_KINDS, readItemFilter, type ItemFilter } from "@/lib/mimir/kinds";
import { tiersFor } from "@/lib/mimir/progress";
import { parseListQuery, type ListQuery } from "@/lib/paging";
import type { MimirItemSort } from "@/lib/list-specs";
import { LibraryView } from "./library-view";

const FIRST: ListQuery<MimirItemSort> = { q: "", sort: "position", dir: "asc", page: 1 };

export type Card = Omit<ItemSummary, "updatedAt">;

const card = ({ id, kind, parentId, position, title, emoji, color, summary, attrs }: ItemSummary): Card => ({
  id,
  kind,
  parentId,
  position,
  title,
  emoji,
  color,
  summary,
  attrs,
});

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());

  const params = await searchParams;
  const read = readItemFilter(params);
  if ("error" in read) notFound();
  const kind: MimirKind = read.filter.kind ?? LIBRARY_KINDS[0]!;
  if (!LIBRARY_KINDS.includes(kind)) notFound();

  const query = parseListQuery(params, MIMIR_ITEM_LIST);
  // Capabilities sit under their agents, and are listed under them; everything else in a tab is top-level.
  const filter: ItemFilter = kind === "capability" ? { kind } : { kind, parentId: null };
  if (kind === "competitor") {
    filter.cat = read.filter.cat;
    filter.featured = read.filter.featured;
  }

  const [page, count, intros, agents] = await Promise.all([
    listItems(query, filter),
    itemCount(kind),
    listItems(FIRST, { kind: "intro" }),
    kind === "capability" ? listItems(FIRST, { kind: "agent" }) : null,
  ]);
  const introId = intros.rows.find((i) => (i.attrs as MimirAttrs).forKind === kind)?.id;
  const intro = introId ? await getItem(introId) : null;
  const tiers = await tiersFor(session.user.id, page.rows.map((r) => r.id));

  return (
    <LibraryView
      kind={kind}
      query={query}
      cat={filter.cat ?? null}
      featured={filter.featured ?? false}
      count={count}
      page={{ ...page, rows: page.rows.map(card) }}
      agents={agents?.rows.map(card) ?? []}
      intro={intro ? { title: intro.item.title, html: (await renderMarkdown(intro.item.body)).html } : null}
      tiers={tiers}
    />
  );
}
