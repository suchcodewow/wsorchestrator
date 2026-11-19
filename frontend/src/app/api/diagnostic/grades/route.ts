/**
 * Typed Diagnostic answers whose grade Claude was unsure of, a page at a time,
 * for Diagnostic Settings → Grades: the ones waiting on review, or with
 * `?decided=1` the decided ones too. Assessments Administrators only.
 */

import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/api-auth";
import { listGrades } from "@/lib/iris/grades";
import { IRIS_GRADE_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { canManageIris } from "@/lib/roles";

export async function GET(req: Request) {
  const { error } = await requireCaller(req, canManageIris);
  if (error) return error;

  const params = new URL(req.url).searchParams;
  const { rows, page, hasMore } = await listGrades(parseListQuery(params, IRIS_GRADE_LIST), { decided: params.get("decided") === "1" });
  return NextResponse.json({ grades: rows, page, hasMore });
}
