/**
 * A one-minute ticket for a framed page to sign in with, asked for by the
 * sign-in popup. Session only: the popup is a browser that has just signed
 * in. See `src/lib/frame-cookie.ts`.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { audited, noteAudit } from "@/lib/audit";
import { FRAME_TICKET_SECONDS, mintFrameTicket } from "@/lib/frame-session";

export const POST = audited(async function POST() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  noteAudit({ target: session.user.email ?? session.user.id, targetLabel: session.user.name ?? undefined });
  const token = await mintFrameTicket(session.user.id);
  return NextResponse.json(
    { token, expiresIn: FRAME_TICKET_SECONDS },
    { headers: { "Cache-Control": "no-store" } },
  );
});
