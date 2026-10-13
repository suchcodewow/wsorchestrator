/**
 * One concept's video, for the person watching it. `GET` answers with a
 * signed URL to play it from and where to start (where they left off, or the
 * beginning if they had reached the end). `PUT` is the player reporting in:
 * where it is, how long the video is, and whether it has ended.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { getMap } from "@/lib/mimir/map/content";
import { getConceptState, saveVideoProgress } from "@/lib/mimir/map/progress";
import { signedVideoUrl } from "@/lib/mimir/map/video";

type Params = { params: Promise<{ id: string }> };

async function videoOf(id: string) {
  const map = await getMap();
  const concept = map?.content.concepts.find((c) => c.id === id);
  return concept?.video ? { name: concept.name, video: concept.video } : null;
}

export async function GET(req: Request, { params }: Params) {
  const { error, user } = await requireUser(req);
  if (error) return error;

  const id = (await params).id;
  const found = await videoOf(id);
  if (!found) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const signed = await signedVideoUrl(found.video.object);
  if (!signed.ok) return NextResponse.json({ error: signed.error }, { status: signed.error === "missing" ? 404 : 503 });

  const state = await getConceptState(user.id, id);
  return NextResponse.json({ url: signed.url, expiresInSeconds: signed.expiresInSeconds, name: found.name, seconds: found.video.seconds, startAt: state.resumeAt, state });
}

const reportSchema = z.object({
  position: z.number().finite().min(0).max(6 * 3600),
  duration: z.number().finite().positive().max(6 * 3600),
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

  const state = await saveVideoProgress(user.id, id, { position: parsed.data.position, duration: parsed.data.duration, ended: parsed.data.ended ?? false });
  noteAudit({ target: id, targetLabel: found.name, detail: { completed: state.completed } });
  return NextResponse.json({ state });
});
