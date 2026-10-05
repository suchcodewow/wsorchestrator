/**
 * The employees stored from the last HiBob sync, a page at a time. eVals
 * administrators read it for their settings; Training administrators search
 * it to add a bootcamp's judges.
 */

import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/api-auth";
import { EMPLOYEE_MATCHES, employeeSummary, listEmployees } from "@/lib/evals/roster";
import { EMPLOYEE_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { canSearchEmployees } from "@/lib/roles";

export async function GET(req: Request) {
  const { error } = await requireCaller(req, canSearchEmployees);
  if (error) return error;

  const params = new URL(req.url).searchParams;
  const asked = params.get("match");
  const match = EMPLOYEE_MATCHES.find((m) => m === asked);
  if (asked && !match) return NextResponse.json({ error: "invalid_match" }, { status: 400 });

  const query = parseListQuery(params, EMPLOYEE_LIST);
  const [{ rows, page, hasMore }, { count, syncedAt }] = await Promise.all([
    listEmployees(query, match),
    employeeSummary(),
  ]);
  return NextResponse.json({ people: rows, page, hasMore, total: count, syncedAt });
}
