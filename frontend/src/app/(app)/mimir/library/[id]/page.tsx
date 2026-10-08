/** One library item: everything on its card, and the coach beside it for the kinds the coach covers. */

import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { renderMarkdown } from "@/lib/markdown";
import { getChat } from "@/lib/mimir/chat";
import { getItem, glossaryIndex } from "@/lib/mimir/items";
import { LIBRARY_KINDS, coachModeOf } from "@/lib/mimir/kinds";
import { getItemProgress } from "@/lib/mimir/progress";
import type { ChatState } from "./chat-panel";
import { ItemView } from "./item-view";

export default async function LibraryItemPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());

  const found = await getItem((await params).id);
  if (!found) notFound();
  const { item, parent, children } = found;
  // A discovery question is read on its group's page.
  if (item.kind === "question" && parent) redirect(`/mimir/library/${encodeURIComponent(parent.id)}`);
  if (!LIBRARY_KINDS.includes(item.kind)) notFound();

  const mode = coachModeOf(item.kind);
  const [body, sections, chat, progress, glossary] = await Promise.all([
    renderMarkdown(item.body),
    Promise.all(item.sections.map(async (s) => ({ title: s.title, html: (await renderMarkdown(s.content)).html }))),
    mode ? getChat(session.user.id, item.id) : null,
    getItemProgress(session.user.id, item.id),
    glossaryIndex(),
  ]);

  let state: ChatState | null = null;
  if (chat && !("error" in chat)) {
    state = {
      ...chat,
      conversation: chat.conversation && {
        id: chat.conversation.id,
        messages: chat.conversation.messages.map((m) => ({ ...m, at: m.at.toISOString() })),
        earlier: chat.conversation.earlier,
      },
      progress: { tier: chat.progress.tier, masteryReady: chat.progress.masteryReady, reflection: chat.progress.reflection },
    };
  }

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
      chat={state}
      glossary={glossary}
    />
  );
}
