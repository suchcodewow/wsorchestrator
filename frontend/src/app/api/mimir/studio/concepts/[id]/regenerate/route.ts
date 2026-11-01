/**
 * Has Claude make a concept's video afresh, or its first: the studio job
 * writes the script and scenes by the explainer standards, narrates and
 * renders it, and puts it on the map. Every accepted comment on the video
 * goes with it as a note of where it was in the video and what it said. Every
 * language is made again with it, since a translation of the old video is no
 * longer the same video. `translationsOnly` leaves the English alone and makes
 * only the translations it lacks.
 */

import { NextResponse } from "next/server";
import { requireMimirStudio } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { getMap } from "@/lib/mimir/map/content";
import { TRANSLATED_LANGUAGES, missingLanguages, videoIn } from "@/lib/mimir/map/schema";
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

  const translationsOnly = ((await req.json().catch(() => null)) as { translationsOnly?: unknown } | null)?.translationsOnly === true;
  const languages = translationsOnly ? (concept.video ? missingLanguages(concept.video) : []) : [...TRANSLATED_LANGUAGES];
  if (translationsOnly && languages.length === 0) return NextResponse.json({ error: "nothing_to_translate" }, { status: 409 });

  const video = concept.video;
  const comments = translationsOnly ? [] : await acceptedComments(concept.id, VIDEO_NOTES_MAX);
  const input: VideoInput = {
    videoId: (video && videoIdOf(video.object)) || newVideoId(map, concept.id),
    previous: video?.object ?? null,
    notes: comments.map((c) => ({
      feedbackId: c.id,
      position: c.position,
      rating: c.rating,
      comment: c.comment!.slice(0, VIDEO_NOTE_CHARS),
      language: c.language,
      current: Boolean(video) && (c.videoObject === null || c.videoObject === videoIn(video!, c.language).object),
    })),
    languages,
    translationsOnly,
  };
  const job = await createVideoJob(user.id, concept, input);
  if (job === "busy") return NextResponse.json({ error: "busy" }, { status: 409 });
  noteAudit({ detail: { job: job.id, videoId: input.videoId, notes: input.notes.length, first: !concept.video, languages, translationsOnly } });
  const started = await runStudioJob(job.id);
  return NextResponse.json({ job, started }, { status: 201 });
});
