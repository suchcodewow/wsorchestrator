/**
 * One concept's video, for the person watching it. `GET` answers with a
 * signed URL to play it from and where to start (where they left off, or the
 * beginning if they had reached the end), in the language asked for, or
 * otherwise the one they chose last, and in English if it is not in that yet.
 * `version` plays a particular file of this video instead, as feedback left on
 * it does. `PUT` is the player reporting in: where it is, how long the video
 * is, and whether it has ended.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { getMap } from "@/lib/mimir/map/content";
import { getConceptState, saveVideoProgress } from "@/lib/mimir/map/progress";
import { TRANSLATED_LANGUAGES, VIDEO_LANGUAGES, videoIn, videoLanguages, type MapVideo } from "@/lib/mimir/map/schema";
import { signedVideoUrl } from "@/lib/mimir/map/video";
import { translatedVideoId, videoIdOf } from "@/lib/mimir/studio/shapes";
import { preferencesOf } from "@/lib/user-preferences";

type Params = { params: Promise<{ id: string }> };

async function videoOf(id: string) {
  const map = await getMap();
  const concept = map?.content.concepts.find((c) => c.id === id);
  return concept?.video ? { name: concept.name, video: concept.video } : null;
}

/** Whether `object` is a file of this video, in any language and from any regeneration. */
function isVersionOf(video: MapVideo, object: string): boolean {
  const id = videoIdOf(video.object);
  return Boolean(id) && [id, ...TRANSLATED_LANGUAGES.map((l) => translatedVideoId(id!, l))].includes(videoIdOf(object));
}

export async function GET(req: Request, { params }: Params) {
  const { error, user } = await requireUser(req);
  if (error) return error;

  const id = (await params).id;
  const found = await videoOf(id);
  if (!found) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const query = new URL(req.url).searchParams;
  const asked = VIDEO_LANGUAGES.find((l) => l === query.get("language")) ?? (await preferencesOf(user.id)).videoLanguage;
  const file = videoIn(found.video, asked);
  const version = query.get("version");
  if (version && !isVersionOf(found.video, version)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const object = version ?? file.object;
  const signed = await signedVideoUrl(object);
  if (!signed.ok) return NextResponse.json({ error: signed.error }, { status: signed.error === "missing" ? 404 : 503 });

  const state = await getConceptState(user.id, id);
  // The place was kept in whichever language they last watched; a share of that one's length carries over to this one's.
  const startAt = state.videoDuration > 0 ? (state.resumeAt / state.videoDuration) * file.seconds : state.resumeAt;
  return NextResponse.json({
    url: signed.url,
    expiresInSeconds: signed.expiresInSeconds,
    name: found.name,
    seconds: file.seconds,
    startAt,
    state,
    language: file.language,
    languages: videoLanguages(found.video),
    object,
  });
}

const reportSchema = z.object({
  position: z
    .number()
    .finite()
    .min(0)
    .max(6 * 3600),
  duration: z
    .number()
    .finite()
    .positive()
    .max(6 * 3600),
  ended: z.boolean().optional(),
});

export const PUT = audited(async function PUT(req: Request, { params }: Params) {
  const { error, user } = await requireUser(req);
  if (error) return error;

  const id = (await params).id;
  const parsed = reportSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const found = await videoOf(id);
  if (!found) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const state = await saveVideoProgress(user.id, id, {
    position: parsed.data.position,
    duration: parsed.data.duration,
    ended: parsed.data.ended ?? false,
  });
  noteAudit({ target: id, targetLabel: found.name, detail: { completed: state.completed } });
  return NextResponse.json({ state });
});
