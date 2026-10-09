/**
 * The browser says a stream has ended after so many chunks. The answer is
 * which chunks are still missing, or that the file is being joined.
 */

import { after, NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { findTrack, finishTrack, finishTrackSchema } from "@/lib/recording/recordings";

type Params = { params: Promise<{ takeId: string; kind: string }> };

export const POST = audited(async function POST(req: Request, { params }: Params) {
  const { error, user } = await requireUser(req);
  if (error) return error;
  const { takeId, kind } = await params;
  const parsed = finishTrackSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const track = await findTrack(user.id, takeId, kind);
  if (!track) return NextResponse.json({ error: "not_found" }, { status: 404 });
  noteAudit({ target: track.id, targetLabel: `${track.kind} of take ${track.takeId}` });

  const result = await finishTrack(track, parsed.data, (job) => after(job));
  return NextResponse.json(result);
});
