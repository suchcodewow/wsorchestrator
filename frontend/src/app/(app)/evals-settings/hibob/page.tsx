/** The HiBob tab: the connection, the import, and who is in the org. */

import { getHibobConnection } from "@/lib/evals/hibob";
import { loadRoster } from "@/lib/evals/roster";
import { secretsConfigured } from "@/lib/secret-box";
import { HibobConnectionView } from "./connection-view";
import { OrgTable } from "./org-table";

export default async function HibobPage() {
  const [connection, roster] = await Promise.all([getHibobConnection(), loadRoster()]);

  return (
    <div className="space-y-10">
      <HibobConnectionView
        connection={
          connection && {
            ...connection,
            updatedAt: connection.updatedAt.toISOString(),
            lastImportAt: connection.lastImportAt?.toISOString() ?? null,
          }
        }
        employeeCount={roster.employeeCount}
        keyConfigured={secretsConfigured()}
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
