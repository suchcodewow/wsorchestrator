/** The recording link to share, and every take recorded through it, the newest first. */

import { auth } from "@/auth";
import { RECORDING_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { getActiveLink, listTakes } from "@/lib/recording/recordings";
import { canManageTrainingSettings } from "@/lib/roles";
import { RecordingsView } from "./recordings-view";

export const dynamic = "force-dynamic";

export default async function RecordingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  const query = parseListQuery(await searchParams, RECORDING_LIST);
  const [page, link] = await Promise.all([listTakes(query), getActiveLink()]);
  return (
    <RecordingsView
      query={query}
      page={page}
      link={link}
      canManage={!!session?.user && canManageTrainingSettings(session.user.access)}
    />
  );
}
