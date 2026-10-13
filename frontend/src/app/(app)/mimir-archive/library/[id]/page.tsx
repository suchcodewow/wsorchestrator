/** One archived library item: everything on its card. */

import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { renderMarkdown } from "@/lib/markdown";
import { getItem, glossaryIndex } from "@/lib/mimir/items";
import { LIBRARY_KINDS } from "@/lib/mimir/kinds";
import { getItemProgress } from "@/lib/mimir/progress";
import { ItemView } from "./item-view";

export default async function LibraryItemPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());

  const found = await getItem((await params).id);
  if (!found) notFound();
  const { item, parent, children } = found;
  // A discovery question is read on its group's page.
  if (item.kind === "question" && parent) redirect(`/mimir-archive/library/${encodeURIComponent(parent.id)}`);
  if (!LIBRARY_KINDS.includes(item.kind)) notFound();

  const [body, sections, progress, glossary] = await Promise.all([
    renderMarkdown(item.body),
    Promise.all(item.sections.map(async (s) => ({ title: s.title, html: (await renderMarkdown(s.content)).html }))),
    getItemProgress(session.user.id, item.id),
    glossaryIndex(),
  ]);

  return (
    <ItemView
      item={{
        id: item.id,
        kind: item.kind,
        title: item.title,
        emoji: item.emoji,
        color: item.color,
        summary: item.summary,
        attrs: item.attrs,
        bodyHtml: body.html,
        sections,
      }}
      parent={parent && { id: parent.id, title: parent.title }}
      holds={children.map((c) => ({ id: c.id, kind: c.kind, title: c.title, emoji: c.emoji, summary: c.summary, attrs: c.attrs }))}
      tier={progress.tier}
      glossary={glossary}
    />
  );
}
