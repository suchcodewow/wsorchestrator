/** The Employees tab: the Employees table as the last HiBob sync left it, a page at a time. */

import { employeeSummary, listEmployees } from "@/lib/evals/roster";
import { EMPLOYEE_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { EmployeesTable } from "./employees-table";

export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = parseListQuery(await searchParams, EMPLOYEE_LIST);
  const [page, { count, syncedAt }] = await Promise.all([listEmployees(query), employeeSummary()]);
  return <EmployeesTable query={query} page={page} count={count} syncedAt={syncedAt?.toISOString() ?? null} />;
}
