/** The Diagnostic's Records: everyone with a sitting, a page at a time with their placements, Participant or not. */

import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/api-auth";
import { isForm } from "@/lib/iris/engine";
import { listRecords, recordCount } from "@/lib/iris/participants";
import { IRIS_RECORD_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { canManageIris } from "@/lib/roles";

export async function GET(req: Request) {
  const { error } = await requireCaller(req, canManageIris);
  if (error) return error;
  const params = new URL(req.url).searchParams;
  const form = params.get("form") ?? "A";
  if (!isForm(form)) return NextResponse.json({ error: "invalid_form" }, { status: 400 });
  const [{ rows, page, hasMore }, total] = await Promise.all([
    listRecords(parseListQuery(params, IRIS_RECORD_LIST), form),
    recordCount(form),
  ]);
  return NextResponse.json({ people: rows, page, hasMore, total });
}
