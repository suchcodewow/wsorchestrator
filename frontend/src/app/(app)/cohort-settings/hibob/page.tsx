/** The HiBob tab: the sync and its log, a page at a time. */

import { hibobServiceUser, listHibobSyncRuns, syncInProgress } from "@/lib/evals/hibob";
import { HIBOB_SYNC_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { HibobSyncView } from "./sync-view";

export default async function HibobPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = parseListQuery(await searchParams, HIBOB_SYNC_LIST);
  const [page, running] = await Promise.all([listHibobSyncRuns(query), syncInProgress()]);

  return (
    <HibobSyncView
      serviceUser={hibobServiceUser()}
      query={query}
      running={running}
      page={{
        ...page,
        rows: page.rows.map((run) => ({
          ...run,
          startedAt: run.startedAt.toISOString(),
          finishedAt: run.finishedAt?.toISOString() ?? null,
        })),
      }}
    />
  );
}
