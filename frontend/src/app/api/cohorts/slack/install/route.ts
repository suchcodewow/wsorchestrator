/**
 * Starts Add to Slack: sends the browser to Slack to install the app. Slack
 * returns to the shared OAuth callback (`lib/oauth-callback.ts`), which checks
 * the state cookie set here. Session-only, as the install ends in a browser
 * and hands the app a bot token for the whole workspace.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { oauthRedirectUri, startOAuth } from "@/lib/oauth-callback";
import { canManageTrainingSettings } from "@/lib/roles";
import { slackApp, slackAuthorizeUrl } from "@/lib/slack-app";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!canManageTrainingSettings(session.user.access)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const app = slackApp();
  if (!app) return NextResponse.json({ error: "not_configured" }, { status: 503 });

  return startOAuth(req, "slack", (state) => slackAuthorizeUrl(app, oauthRedirectUri(req), state));
}
