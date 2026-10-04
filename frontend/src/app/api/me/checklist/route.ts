/** The checklist items this account's email owns, across every bootcamp, a page at a time. */

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { MY_CHECKLIST_LIST, isChecklistStatus } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { listMyChecklist, myOpenChecklistCount } from "@/lib/scheduler/checklist";

export async function GET(req: Request) {
  const { error, user } = await requireUser(req);
  if (error) return error;

  const params = new URL(req.url).searchParams;
  const asked = params.get("status");
  const status = isChecklistStatus(asked) ? asked : "open";
  const [{ rows, page, hasMore }, open] = await Promise.all([
    listMyChecklist(user.email, status, parseListQuery(params, MY_CHECKLIST_LIST)),
    myOpenChecklistCount(user.email),
  ]);
  return NextResponse.json({ items: rows, page, hasMore, open });
}
