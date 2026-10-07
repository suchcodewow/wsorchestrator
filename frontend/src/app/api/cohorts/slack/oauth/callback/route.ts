/**
 * Where Slack sends the browser back after Add to Slack. Trades the code for
 * the bot token, saves it, and returns to Cohort Settings → Slack with
 * `?slack=` saying how it went. A GET, so `audited` never sees it; it records
 * the install itself.
 */

import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { recordAudit, requestIp } from "@/lib/audit";
import { canManageTrainingSettings } from "@/lib/roles";
import {
  SLACK_CALLBACK_PATH,
  SLACK_STATE_COOKIE,
  appBase,
  exchangeSlackCode,
  saveSlackInstallation,
  slackApp,
  slackRedirectUri,
} from "@/lib/slack-app";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const user = session.user;
  if (!canManageTrainingSettings(user.access)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const app = slackApp();
  if (!app) return NextResponse.json({ error: "not_configured" }, { status: 503 });

  const back = (result: string, detail?: string) => {
    const to = new URL("/cohort-settings/slack", appBase(req));
    to.searchParams.set("slack", result);
    if (detail) to.searchParams.set("detail", detail);
    const res = NextResponse.redirect(to);
    res.cookies.delete({ name: SLACK_STATE_COOKIE, path: SLACK_CALLBACK_PATH });
    return res;
  };

  // Slack echoes the state on a cancel too, so check it first.
  const params = req.nextUrl.searchParams;
  const state = params.get("state");
  if (!state || state !== req.cookies.get(SLACK_STATE_COOKIE)?.value) return back("bad_state");
  if (params.get("error")) return back("cancelled");
  const code = params.get("code");
  if (!code) return back("bad_state");

  const result = await exchangeSlackCode(app, code, slackRedirectUri(req));
  const audit = {
    actor: { id: user.id, email: user.email ?? null, name: user.name ?? null },
    via: "session" as const,
    action: `GET ${SLACK_CALLBACK_PATH}`,
    path: SLACK_CALLBACK_PATH,
    ip: await requestIp(),
  };
  if (!result.ok) {
    await recordAudit({
      ...audit,
      summary: "Tried to add the Slack app to the workspace.",
      status: 502,
      outcome: "failed",
      detail: { error: result.error },
    });
    return back("slack_error", result.error);
  }

  const { teamId, teamName, appId, botUserId, scopes } = result.granted;
  await saveSlackInstallation(user.id, result.granted);
  await recordAudit({
    ...audit,
    summary: "Added the Slack app to the workspace.",
    target: teamId,
    targetLabel: teamName,
    status: 200,
    outcome: "succeeded",
    detail: { appId, botUserId, scopes },
  });
  return back("installed");
}
