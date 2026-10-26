/**
 * Has Claude make a concept's video afresh, or its first: the studio job
 * writes the script and scenes by the explainer standards, narrates and
 * renders it, and puts it on the map. Every accepted comment on the video
 * goes with it as a note of where it was in the video and what it said.
 */

import { NextResponse } from "next/server";
import { requireMimirStudio } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { getMap } from "@/lib/mimir/map/content";
import { bucket } from "@/lib/mimir/map/video";
import { createVideoJob } from "@/lib/mimir/studio/jobs";
import { newVideoId, VIDEO_NOTE_CHARS, VIDEO_NOTES_MAX, videoIdOf, type VideoInput } from "@/lib/mimir/studio/shapes";
import { runStudioJob, studioConfigured } from "@/lib/mimir/studio/trigger";
import { acceptedComments } from "@/lib/video-feedback";

type Params = { params: Promise<{ id: string }> };

export const POST = audited(async function POST(req: Request, { params }: Params) {
  const { error, user } = await requireMimirStudio(req);
  if (error) return error;

  const id = (await params).id;
  const map = (await getMap())?.content;
  const concept = map?.concepts.find((c) => c.id === id);
  if (!map || !concept) return NextResponse.json({ error: "not_found" }, { status: 404 });
  noteAudit({ target: concept.id, targetLabel: concept.name });
  if (!bucket() || !studioConfigured()) return NextResponse.json({ error: "not_configured" }, { status: 503 });

  const comments = await acceptedComments(concept.id, VIDEO_NOTES_MAX);
  const input: VideoInput = {
    videoId: (concept.video && videoIdOf(concept.video.object)) || newVideoId(map, concept.id),
    previous: concept.video?.object ?? null,
    notes: comments.map((c) => ({ feedbackId: c.id, position: c.position, rating: c.rating, comment: c.comment!.slice(0, VIDEO_NOTE_CHARS) })),
  };
  const job = await createVideoJob(user.id, concept, input);
  if (job === "busy") return NextResponse.json({ error: "busy" }, { status: 409 });
  noteAudit({ detail: { job: job.id, videoId: input.videoId, notes: input.notes.length, first: !concept.video } });
  const started = await runStudioJob(job.id);
  return NextResponse.json({ job, started }, { status: 201 });
});
