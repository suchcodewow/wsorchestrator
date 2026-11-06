/**
 * Everyone with an account, for Coach Canary Settings → Reporting: their
 * concept videos watched to the end, the concepts the coach has marked them as
 * knowing, and their hands-on experiences, a page at a time.
 */

import { NextResponse } from "next/server";
import { requireMimirAdministrator } from "@/lib/api-auth";
import { EXPERIENCE_REPORT_LIST } from "@/lib/list-specs";
import { listExperienceReport } from "@/lib/mimir/experience-progress";
import { parseListQuery } from "@/lib/paging";

export async function GET(req: Request) {
  const { error } = await requireMimirAdministrator(req);
  if (error) return error;

  const { rows, page, hasMore } = await listExperienceReport(parseListQuery(new URL(req.url).searchParams, EXPERIENCE_REPORT_LIST));
  return NextResponse.json({ people: rows, page, hasMore });
}
