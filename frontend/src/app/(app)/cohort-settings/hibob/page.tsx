/** The HiBob tab: the sync and its log. */

import { hibobServiceUser, listHibobSyncRuns } from "@/lib/evals/hibob";
import { HibobSyncView } from "./sync-view";

export default async function HibobPage() {
  const runs = await listHibobSyncRuns();

  return (
    <HibobSyncView
      serviceUser={hibobServiceUser()}
      runs={runs.map((run) => ({
        ...run,
        startedAt: run.startedAt.toISOString(),
        finishedAt: run.finishedAt?.toISOString() ?? null,
      }))}
    />
  );
}
