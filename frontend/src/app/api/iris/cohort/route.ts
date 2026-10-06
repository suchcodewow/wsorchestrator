/** Everyone with a finished live Iris sitting on one form, and their placements, a page at a time. */

import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/api-auth";
import { listCohort } from "@/lib/iris/cohort";
import { isForm } from "@/lib/iris/engine";
import { IRIS_COHORT_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { canManageIris } from "@/lib/roles";

export async function GET(req: Request) {
  const { error } = await requireCaller(req, canManageIris);
  if (error) return error;
  const params = new URL(req.url).searchParams;
  const form = params.get("form") ?? "A";
  if (!isForm(form)) return NextResponse.json({ error: "invalid_form" }, { status: 400 });
  const { rows, page, hasMore } = await listCohort(parseListQuery(params, IRIS_COHORT_LIST), form);
  return NextResponse.json({ people: rows, page, hasMore });
}
