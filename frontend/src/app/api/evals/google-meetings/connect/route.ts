/**
 * Starts connecting the Google account Google Meetings sends invites from:
 * sends the browser to Google's consent screen, to sign in as that account.
 * Session-only, since it hands the app a standing token: see docs/api.md.
 */

import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { GOOGLE_STATE_COOKIE, googleRedirectUri, GOOGLE_CALLBACK_PATH } from "@/lib/evals/google-meetings";
import { authorizationUrl, oauthClient } from "@/lib/google-calendar";
import { canManageEvalsSettings } from "@/lib/roles";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!canManageEvalsSettings(session.user.access)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const client = oauthClient();
  if (!client) return NextResponse.json({ error: "not_configured" }, { status: 503 });

  const state = randomBytes(24).toString("base64url");
  const res = NextResponse.redirect(
    authorizationUrl({
      clientId: client.id,
      redirectUri: googleRedirectUri(req),
      state,
      // The account to sign in as, when the deployment names it.
      loginHint: process.env.GOOGLE_USER?.trim() || undefined,
    }),
  );
  res.cookies.set(GOOGLE_STATE_COOKIE, state, {
    httpOnly: true,
    secure: new URL(googleRedirectUri(req)).protocol === "https:",
    sameSite: "lax",
    path: GOOGLE_CALLBACK_PATH,
    maxAge: 10 * 60,
  });
  return res;
}
