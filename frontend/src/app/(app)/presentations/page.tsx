/** Every presentation, by name, to present or open. */

import { auth } from "@/auth";
import { PRESENTATION_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { listPresentations } from "@/lib/presentations/presentations";
import { canManageTrainingSettings } from "@/lib/roles";
import { PresentationsView } from "./presentations-view";

export const dynamic = "force-dynamic";

export default async function PresentationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  const query = parseListQuery(await searchParams, PRESENTATION_LIST);
  return (
    <PresentationsView
      query={query}
      page={await listPresentations(query)}
      canManage={session?.user ? canManageTrainingSettings(session.user.access) : false}
    />
  );
}
