/**
 * One chunk of a stream, as the participant's browser uploads it when
 * recordings are kept on disk. Sending the same chunk again replaces it, so a
 * browser that never heard back retries without harm. With a bucket, chunks
 * go straight to it on signed URLs (`upload-urls`) and never come here.
 */

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { RECORDING_LIMITS } from "@/db/schema";
import { audited, noteAudit } from "@/lib/audit";
import { acceptsChunks, findTrack, noteChunk, uploadMode } from "@/lib/recording/recordings";
import { putChunk } from "@/lib/recording/storage";

type Params = { params: Promise<{ takeId: string; kind: string; seq: string }> };

export const PUT = audited(async function PUT(req: Request, { params }: Params) {
  const { error, user } = await requireUser(req);
  if (error) return error;
  const { takeId, kind, seq: rawSeq } = await params;
  if (uploadMode() === "direct") return NextResponse.json({ error: "direct_upload" }, { status: 409 });
  const seq = Number(rawSeq);
  if (!/^\d+$/.test(rawSeq) || seq >= RECORDING_LIMITS.chunks) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  const declared = req.headers.get("content-length");
  if (Number(declared ?? 0) > RECORDING_LIMITS.chunkBytes) {
    return NextResponse.json({ error: "too_large" }, { status: 413 });
  }

  const track = await findTrack(user.id, takeId, kind);
  if (!track) return NextResponse.json({ error: "not_found" }, { status: 404 });
  noteAudit({ target: track.id, targetLabel: `${track.kind} chunk ${seq}` });
  if (!acceptsChunks(track)) return NextResponse.json({ error: "finished" }, { status: 409 });

  const data = new Uint8Array(await req.arrayBuffer());
  if (data.byteLength === 0) return NextResponse.json({ error: "empty" }, { status: 400 });
  if (data.byteLength > RECORDING_LIMITS.chunkBytes) return NextResponse.json({ error: "too_large" }, { status: 413 });
  // A body cut short on the way — a dropped connection, or a proxy's size limit — is never kept: the browser sends it again.
  if (declared !== null && data.byteLength !== Number(declared)) {
    return NextResponse.json({ error: "truncated" }, { status: 400 });
  }

  await putChunk({ takeId: track.takeId, kind: track.kind }, seq, data);
  await noteChunk(track.id);
  return new Response(null, { status: 204 });
});
