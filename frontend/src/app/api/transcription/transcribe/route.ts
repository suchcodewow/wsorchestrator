/** The transcript of a whole recording, sent as form data. Nothing is kept. */

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { MAX_TRANSCRIBE_BYTES } from "@/lib/recording/deepgram";
import { transcribe } from "@/lib/recording/transcription";

export const maxDuration = 120;

export const POST = audited(async function POST(req: Request) {
  const { error } = await requireUser(req);
  if (error) return error;

  const form = await req.formData().catch(() => null);
  const audio = form?.get("audio");
  if (!audio || typeof audio === "string") {
    return NextResponse.json({ error: "malformed" }, { status: 400 });
  }
  if (audio.size === 0) return NextResponse.json({ error: "empty" }, { status: 400 });
  if (audio.size > MAX_TRANSCRIBE_BYTES) {
    return NextResponse.json({ error: "too_large" }, { status: 413 });
  }

  const got = await transcribe(audio);
  if ("error" in got) {
    if (got.detail) noteAudit({ detail: { upstream: got.detail } });
    return NextResponse.json(
      { error: got.error },
      { status: got.error === "unconfigured" ? 503 : 502 },
    );
  }
  return NextResponse.json({ transcript: got.transcript });
});
