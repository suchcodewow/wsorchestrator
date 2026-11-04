/** The glossary: every term, a category at a time or searched across all of them. */

import { redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { MIMIR_ITEM_LIST, type MimirItemSort } from "@/lib/list-specs";
import { itemCount, listItems } from "@/lib/mimir/items";
import { parseListQuery, type ListQuery } from "@/lib/paging";
import { GlossaryView } from "./glossary-view";

const FIRST: ListQuery<MimirItemSort> = { q: "", sort: "position", dir: "asc", page: 1 };

export default async function GlossaryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());

  const params = await searchParams;
  const query = parseListQuery(params, MIMIR_ITEM_LIST);
  const asked = typeof params.category === "string" ? params.category : null;

  const categories = await listItems(FIRST, { kind: "category" });
  const category = categories.rows.find((c) => c.id === asked) ?? null;
  const [terms, count] = await Promise.all([
    listItems(
      { ...query, sort: category ? query.sort : query.sort === "position" ? "title" : query.sort },
      { kind: "term", parentId: category?.id },
    ),
    itemCount("term"),
  ]);

  return (
    <GlossaryView
      query={query}
      count={count}
      categories={categories.rows.map((c) => ({ id: c.id, title: c.title, emoji: c.emoji }))}
      category={category?.id ?? null}
      page={{
        ...terms,
        rows: terms.rows.map((t) => ({
          id: t.id,
          title: t.title,
          category: categories.rows.find((c) => c.id === t.parentId)?.title ?? "",
          definition: t.summary,
          seeAlso: t.attrs.seeAlso ?? "",
        })),
      }}
    />
  );
}
