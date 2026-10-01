/**
 * The Organization tab: everyone the last HiBob sync found reporting up to
 * the Organization Leader set on the Automation tab, a page at a time.
 */

import { employeeByEmail, listOrganizationMembers, organizationSummary } from "@/lib/evals/roster";
import { ORGANIZATION_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { OrganizationTable } from "./organization-table";

export default async function OrganizationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = parseListQuery(await searchParams, ORGANIZATION_LIST);
  const [page, summary] = await Promise.all([listOrganizationMembers(query), organizationSummary()]);
  const leader = summary.leaderEmail ? await employeeByEmail(summary.leaderEmail) : null;
  return (
    <OrganizationTable
      query={query}
      page={page}
      count={summary.count}
      leaderEmail={summary.leaderEmail}
      leaderName={leader?.fullName ?? null}
      current={summary.current}
    />
  );
}
