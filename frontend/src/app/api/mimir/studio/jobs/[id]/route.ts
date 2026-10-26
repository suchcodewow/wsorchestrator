/** One Mimir Studio job; for a deck read and waiting, what publishing it would change. */

import { NextResponse } from "next/server";
import { requireMimirStudio } from "@/lib/api-auth";
import { getMap } from "@/lib/mimir/map/content";
import { getJob } from "@/lib/mimir/studio/jobs";
import { draftOf } from "@/lib/mimir/studio/publish";
import { diffMaps, withLiveVideos } from "@/lib/mimir/studio/shapes";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  const { error } = await requireMimirStudio(req);
  if (error) return error;

  const job = await getJob((await params).id);
  if (!job) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const draft = job.status === "ready" ? draftOf(job) : null;
  if (!draft) return NextResponse.json({ job, diff: null });
  const live = (await getMap())?.content ?? null;
  return NextResponse.json({ job, diff: diffMaps(live, withLiveVideos(draft.draft, live)) });
}
