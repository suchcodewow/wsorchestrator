/** The HiBob tab: the sync, its log, and who is in the org. */

import { hibobServiceUser, listHibobSyncRuns } from "@/lib/evals/hibob";
import { loadRoster } from "@/lib/evals/roster";
import { OrgTable } from "./org-table";
import { HibobSyncView } from "./sync-view";

export default async function HibobPage() {
  const [runs, roster] = await Promise.all([listHibobSyncRuns(), loadRoster()]);

  return (
    <div className="space-y-10">
      <HibobSyncView
        serviceUser={hibobServiceUser()}
        runs={runs.map((run) => ({
          ...run,
          startedAt: run.startedAt.toISOString(),
          finishedAt: run.finishedAt?.toISOString() ?? null,
        }))}
      />
      {roster.employeeCount > 0 && (
        <OrgTable
          rootEmail={roster.rootEmail}
          rootFound={roster.rootFound}
          people={roster.people}
        />
      )}
    </div>
  );
}
