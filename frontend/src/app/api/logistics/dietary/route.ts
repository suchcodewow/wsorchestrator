/** Everyone in the current cohort who has registered, those with dietary needs first, and who has yet to register. */

import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/api-auth";
import { DIETARY_LIST, UNREGISTERED_LIST, UNREGISTERED_PREFIX } from "@/lib/list-specs";
import { dietaryCounts, listDietaryNeeds, listUnregistered } from "@/lib/logistics/responses";
import { parseListQuery } from "@/lib/paging";
import { canUseTraining } from "@/lib/roles";

export async function GET(req: Request) {
  const { error } = await requireCaller(req, canUseTraining);
  if (error) return error;

  const params = new URL(req.url).searchParams;
  const [{ rows, page, hasMore }, counts, unregistered] = await Promise.all([
    listDietaryNeeds(parseListQuery(params, DIETARY_LIST)),
    dietaryCounts(),
    listUnregistered(parseListQuery(params, UNREGISTERED_LIST, UNREGISTERED_PREFIX)),
  ]);
  return NextResponse.json({
    attendees: rows,
    page,
    hasMore,
    counts,
    unregistered: { people: unregistered.rows, page: unregistered.page, hasMore: unregistered.hasMore },
  });
}
