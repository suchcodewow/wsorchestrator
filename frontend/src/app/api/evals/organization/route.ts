/** Who the last HiBob sync found under the Organization Leader, a page at a time. */

import { NextResponse } from "next/server";
import { requireEvalsAdministrator } from "@/lib/api-auth";
import { listOrganizationMembers, organizationSummary } from "@/lib/evals/roster";
import { ORGANIZATION_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";

export async function GET(req: Request) {
  const { error } = await requireEvalsAdministrator(req);
  if (error) return error;

  const query = parseListQuery(new URL(req.url).searchParams, ORGANIZATION_LIST);
  const [{ rows, page, hasMore }, { count, leaderEmail, current }] = await Promise.all([
    listOrganizationMembers(query),
    organizationSummary(),
  ]);
  return NextResponse.json({ members: rows, page, hasMore, total: count, leaderEmail, current });
}
