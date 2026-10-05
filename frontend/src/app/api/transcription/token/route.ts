/** A short-lived Deepgram token, so the browser can stream audio for a live transcript. */

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { grantToken } from "@/lib/recording/transcription";

export const POST = audited(async function POST(req: Request) {
  const { error } = await requireUser(req);
  if (error) return error;

  const got = await grantToken();
  if ("error" in got) {
    if (got.detail) noteAudit({ detail: { upstream: got.detail } });
    return NextResponse.json(
      { error: got.error },
      { status: got.error === "unconfigured" ? 503 : 502 },
    );
  }
  return NextResponse.json({ token: got.token, expiresIn: got.expiresIn });
});
