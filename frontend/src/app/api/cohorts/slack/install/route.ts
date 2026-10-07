/**
 * Starts Add to Slack: sends the browser to Slack to install the app, with a
 * state cookie that `oauth/callback` checks. Session-only, as the install
 * ends in a browser and hands the app a bot token for the whole workspace.
 */

import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { canManageTrainingSettings } from "@/lib/roles";
import {
  SLACK_CALLBACK_PATH,
  SLACK_STATE_COOKIE,
  slackApp,
  slackAuthorizeUrl,
  slackRedirectUri,
} from "@/lib/slack-app";

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

  const state = randomBytes(24).toString("base64url");
  const redirectUri = slackRedirectUri(req);
  const res = NextResponse.redirect(slackAuthorizeUrl(app, redirectUri, state));
  res.cookies.set(SLACK_STATE_COOKIE, state, {
    httpOnly: true,
    secure: redirectUri.startsWith("https:"),
    sameSite: "lax",
    path: SLACK_CALLBACK_PATH,
    maxAge: 600,
  });
  return res;
}
