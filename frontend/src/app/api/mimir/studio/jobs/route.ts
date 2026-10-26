/** Mimir Studio's jobs, decks and videos, a page at a time, the newest first. */

import { NextResponse } from "next/server";
import { MIMIR_STUDIO_JOB_KINDS } from "@/db/schema";
import { requireMimirStudio } from "@/lib/api-auth";
import { MIMIR_STUDIO_JOB_LIST } from "@/lib/list-specs";
import { listJobs } from "@/lib/mimir/studio/jobs";
import { parseListQuery } from "@/lib/paging";

export async function GET(req: Request) {
  const { error } = await requireMimirStudio(req);
  if (error) return error;

  const params = new URL(req.url).searchParams;
  const { rows, page, hasMore } = await listJobs(parseListQuery(params, MIMIR_STUDIO_JOB_LIST), {
    kind: MIMIR_STUDIO_JOB_KINDS.find((k) => k === params.get("kind")),
    conceptId: params.get("concept") || undefined,
  });
  return NextResponse.json({ jobs: rows, page, hasMore });
}
