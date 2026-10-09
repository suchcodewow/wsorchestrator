/**
 * Signed URLs for the browser to upload chunks of a stream straight to the
 * bucket, a batch at a time ahead of the chunks themselves. One request — one
 * audit row — covers about 50 seconds of a stream; the chunks never pass
 * through the app.
 */

import { NextResponse } from "next/server";
import { audited, noteAudit } from "@/lib/audit";
import { acceptsChunks, findTrack, uploadMode, uploadUrls, uploadUrlsSchema } from "@/lib/recording/recordings";

type Params = { params: Promise<{ id: string; takeId: string; kind: string }> };

export const POST = audited(async function POST(req: Request, { params }: Params) {
  const { id, takeId, kind } = await params;
  if (uploadMode() !== "direct") return NextResponse.json({ error: "app_upload" }, { status: 409 });
  const parsed = uploadUrlsSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const track = await findTrack(id, takeId, kind);
  if (!track) return NextResponse.json({ error: "not_found" }, { status: 404 });
  noteAudit({ target: track.id, targetLabel: `${track.kind} chunks ${Math.min(...parsed.data.seqs)}–${Math.max(...parsed.data.seqs)}` });
  if (!acceptsChunks(track)) return NextResponse.json({ error: "finished" }, { status: 409 });

  return NextResponse.json({ urls: await uploadUrls(track, parsed.data.seqs) });
});
