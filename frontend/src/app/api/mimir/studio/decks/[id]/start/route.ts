/** Sets a deck's job going once its file is in the bucket. */

import { NextResponse } from "next/server";
import { requireMimirStudio } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { objectSize } from "@/lib/recording/gcs";
import { bucket } from "@/lib/mimir/map/video";
import { getJob, moveJob } from "@/lib/mimir/studio/jobs";
import { deckObject } from "@/lib/mimir/studio/shapes";
import { runStudioJob } from "@/lib/mimir/studio/trigger";

type Params = { params: Promise<{ id: string }> };

export const POST = audited(async function POST(req: Request, { params }: Params) {
  const { error } = await requireMimirStudio(req);
  if (error) return error;

  const job = await getJob((await params).id);
  if (!job || job.kind !== "deck") return NextResponse.json({ error: "not_found" }, { status: 404 });
  noteAudit({ target: job.id, targetLabel: job.label });
  if (job.status !== "uploading") return NextResponse.json({ error: "not_uploading" }, { status: 409 });
  const b = bucket();
  if (!b) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  if ((await objectSize(b, deckObject(job.id))) === null) return NextResponse.json({ error: "no_file" }, { status: 409 });

  const queued = await moveJob(job.id, "deck", "uploading", "queued", { progress: "Waiting for the studio to start." });
  if (!queued) return NextResponse.json({ error: "not_uploading" }, { status: 409 });
  const started = await runStudioJob(queued.id);
  return NextResponse.json({ job: (await getJob(queued.id)) ?? queued, started });
});
