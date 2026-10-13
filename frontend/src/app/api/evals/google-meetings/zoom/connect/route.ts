/**
 * Starts connecting the Zoom user Google Meetings schedules its Zoom meetings
 * as: sends the browser to Zoom's consent screen, to sign in as that user.
 * Zoom returns to the shared OAuth callback (`lib/oauth-callback.ts`).
 * Session-only, since it hands the app a standing token: see docs/api.md.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { oauthRedirectUri, startOAuth } from "@/lib/oauth-callback";
import { canManageEvalsSettings } from "@/lib/roles";
import { authorizationUrl, zoomApp } from "@/lib/zoom";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!canManageEvalsSettings(session.user.access)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const app = zoomApp();
  if (!app) return NextResponse.json({ error: "not_configured" }, { status: 503 });

  return startOAuth(req, "zoom-meetings", (state) =>
    authorizationUrl({ clientId: app.clientId, redirectUri: oauthRedirectUri(req), state }),
  );
}
