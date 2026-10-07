/**
 * Starts connecting the Google account Google Meetings sends invites from:
 * sends the browser to Google's consent screen, to sign in as that account.
 * Google returns to the shared OAuth callback (`lib/oauth-callback.ts`).
 * Session-only, since it hands the app a standing token: see docs/api.md.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { authorizationUrl, oauthClient } from "@/lib/google-calendar";
import { oauthRedirectUri, startOAuth } from "@/lib/oauth-callback";
import { canManageEvalsSettings } from "@/lib/roles";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!canManageEvalsSettings(session.user.access)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const client = oauthClient();
  if (!client) return NextResponse.json({ error: "not_configured" }, { status: 503 });

  return startOAuth(req, "google-meetings", (state) =>
    authorizationUrl({
      clientId: client.id,
      redirectUri: oauthRedirectUri(req),
      state,
      // The account to sign in as, when the deployment names it.
      loginHint: process.env.GOOGLE_USER?.trim() || undefined,
    }),
  );
}
