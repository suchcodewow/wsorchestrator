/** The Employees tab: the whole Employees table, as the last HiBob sync left it. */

import { listEmployees } from "@/lib/evals/roster";
import { EmployeesTable } from "./employees-table";

export default async function EmployeesPage() {
  const { people, syncedAt } = await listEmployees();
  return <EmployeesTable people={people} syncedAt={syncedAt?.toISOString() ?? null} />;
}
