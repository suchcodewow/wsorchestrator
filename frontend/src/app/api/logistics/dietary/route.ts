/** Attendees' dietary needs from the intake form, the most critical first. */

import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/api-auth";
import { DIETARY_LIST } from "@/lib/list-specs";
import { dietaryCounts, listDietaryNeeds } from "@/lib/logistics/responses";
import { parseListQuery } from "@/lib/paging";
import { canUseTraining } from "@/lib/roles";

export async function GET(req: Request) {
  const { error } = await requireCaller(req, canUseTraining);
  if (error) return error;

  const query = parseListQuery(new URL(req.url).searchParams, DIETARY_LIST);
  const [{ rows, page, hasMore }, counts] = await Promise.all([listDietaryNeeds(query), dietaryCounts()]);
  return NextResponse.json({ attendees: rows, page, hasMore, counts });
}
