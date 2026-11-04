/** One Mimir item, open for editing. */

import { notFound } from "next/navigation";
import { getItem } from "@/lib/mimir/items";
import { ItemEditor } from "../item-editor";

export default async function EditItemPage({ params }: { params: Promise<{ id: string }> }) {
  const found = await getItem((await params).id);
  if (!found) notFound();
  const { item, children } = found;
  return (
    <ItemEditor
      item={{
        id: item.id,
        kind: item.kind,
        parentId: item.parentId,
        position: item.position,
        title: item.title,
        emoji: item.emoji,
        color: item.color,
        summary: item.summary,
        body: item.body,
        sections: item.sections,
        attrs: item.attrs,
        updatedAt: item.updatedAt.toISOString(),
      }}
      holds={children.length}
      kind={item.kind}
    />
  );
}
