/**
 * The Organization tab: everyone the last HiBob sync found reporting up to
 * the Organization Leader set on the Automation tab.
 */

import { employeeNamesByEmail, listOrganizationMembers } from "@/lib/evals/roster";
import { OrganizationTable } from "./organization-table";

export default async function OrganizationPage() {
  const [snapshot, names] = await Promise.all([listOrganizationMembers(), employeeNamesByEmail()]);
  return (
    <OrganizationTable
      members={snapshot.members}
      leaderEmail={snapshot.leaderEmail}
      leaderName={snapshot.leaderEmail ? names.get(snapshot.leaderEmail) ?? null : null}
      current={snapshot.current}
    />
  );
}
