/**
 * Trades a sign-in popup's ticket for a session of the frame's own, kept in a
 * partitioned cookie. Public: the frame has no session yet, and the ticket is
 * what says who it is. See `src/lib/frame-cookie.ts`.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { audited, noteAudit } from "@/lib/audit";
import { noteCaller } from "@/lib/audit-context";
import { FRAME_SESSION_COOKIE, FRAME_SESSION_MAX_AGE, sentCrossSite } from "@/lib/frame-cookie";
import { claimFrameTicket } from "@/lib/frame-session";

const postSchema = z.object({ token: z.string().min(1).max(200) });

export const POST = audited(async function POST(req: Request) {
  // Another site could otherwise sign a learner's frame in as someone else.
  if (sentCrossSite(req.headers)) {
    return NextResponse.json({ error: "cross_site" }, { status: 403 });
  }

  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const claimed = await claimFrameTicket(parsed.data.token);
  if (!claimed) return NextResponse.json({ error: "expired" }, { status: 410 });

  const { user } = claimed;
  noteCaller(user, "session");
  noteAudit({ target: user.email ?? user.id, targetLabel: user.name ?? undefined });

  const res = NextResponse.json({ email: user.email, name: user.name });
  res.cookies.set(FRAME_SESSION_COOKIE, claimed.sessionToken, {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    partitioned: true,
    path: "/",
    maxAge: FRAME_SESSION_MAX_AGE,
  });
  return res;
});
