/** A blank Mimir item to fill in, of the kind the list was filtered to. */

import { isMimirKind } from "@/lib/mimir/kinds";
import { ItemEditor } from "../item-editor";

export default async function NewItemPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const asked = (await searchParams).kind;
  return <ItemEditor item={null} holds={0} kind={isMimirKind(asked) ? asked : "capability"} />;
}
