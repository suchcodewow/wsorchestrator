/** The employees stored from the last HiBob sync, a page at a time. */

import { NextResponse } from "next/server";
import { requireEvalsAdministrator } from "@/lib/api-auth";
import { employeeSummary, listEmployees } from "@/lib/evals/roster";
import { EMPLOYEE_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";

export async function GET(req: Request) {
  const { error } = await requireEvalsAdministrator(req);
  if (error) return error;

  const query = parseListQuery(new URL(req.url).searchParams, EMPLOYEE_LIST);
  const [{ rows, page, hasMore }, { count, syncedAt }] = await Promise.all([
    listEmployees(query),
    employeeSummary(),
  ]);
  return NextResponse.json({ people: rows, page, hasMore, total: count, syncedAt });
}
