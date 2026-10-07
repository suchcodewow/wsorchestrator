/**
 * What the shared OAuth callback (`lib/oauth-callback.ts`) does for each
 * purpose: who may finish it, whether this deployment can, how its code is
 * traded and saved, and which page it reports back to. A new connection is a
 * new entry here and a start route that calls `startOAuth`; no provider
 * console needs another redirect URI.
 *
 * Each purpose keeps the outcome words its page already reads, as
 * `?slack=` and `?google=`. A GET, so `audited` never sees it: each outcome
 * that reaches a provider records itself.
 */

import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { recordAudit, requestIp, type AuditEntry } from "@/lib/audit";
import { saveGoogleConnection } from "@/lib/evals/google-meetings";
import { exchangeCode, GOOGLE_MEETING_SCOPES, oauthClient } from "@/lib/google-calendar";
import {
  appBase,
  OAUTH_CALLBACK_PATH,
  OAUTH_STATE_COOKIE,
  oauthRedirectUri,
  purposeOf,
  stateMatches,
  type OAuthPurpose,
} from "@/lib/oauth-callback";
import { canManageEvalsSettings, canManageTrainingSettings, type Access } from "@/lib/roles";
import { sealSecret } from "@/lib/secret-box";
import { exchangeSlackCode, saveSlackInstallation, slackApp } from "@/lib/slack-app";

type Actor = { id: string; email: string | null; name: string | null };

/** How a return ended: the word for the page's query parameter, and anything to send with it. */
type Outcome = { result: string; extra?: Record<string, string> };

type Purpose = {
  allowed: (access: Access) => boolean;
  configured: () => boolean;
  /** The page to go back to, and the query parameter it reads the outcome from. */
  page: string;
  param: string;
  /** The words for a state that does not match, and for a consent the person refused. */
  badState: string;
  cancelled: string;
  /** What the audit trail calls it. */
  action: string;
  complete: (input: { req: NextRequest; code: string; actor: Actor; audit: (entry: Partial<AuditEntry>) => Promise<void> }) => Promise<Outcome>;
};

const PURPOSES: Record<OAuthPurpose, Purpose> = {
  /** Add to Slack on Cohort Settings → Slack: the bot token the cohort channel sync acts with. */
  slack: {
    allowed: canManageTrainingSettings,
    configured: () => slackApp() !== null,
    page: "/cohort-settings/slack",
    param: "slack",
    badState: "bad_state",
    cancelled: "cancelled",
    action: "cohorts.slack.install",
    async complete({ req, code, actor, audit }) {
      const result = await exchangeSlackCode(slackApp()!, code, oauthRedirectUri(req));
      if (!result.ok) {
        await audit({ summary: "Tried to add the Slack app to the workspace.", status: 502, outcome: "failed", detail: { error: result.error } });
        return { result: "slack_error", extra: { detail: result.error } };
      }
      const { teamId, teamName, appId, botUserId, scopes } = result.granted;
      await saveSlackInstallation(actor.id, result.granted);
      await audit({
        summary: "Added the Slack app to the workspace.",
        target: teamId,
        targetLabel: teamName,
        status: 200,
        outcome: "succeeded",
        detail: { appId, botUserId, scopes },
      });
      return { result: "installed" };
    },
  },

  /** Connect Google account on eVals Settings → Google Meetings: the account invites are sent from. */
  "google-meetings": {
    allowed: canManageEvalsSettings,
    configured: () => oauthClient() !== null,
    page: "/evals-settings/google-meetings",
    param: "google",
    badState: "expired",
    cancelled: "denied",
    action: "evals.google-meetings.connect",
    async complete({ req, code, actor, audit }) {
      let account: Awaited<ReturnType<typeof exchangeCode>>;
      try {
        account = await exchangeCode(oauthClient()!, code, oauthRedirectUri(req));
      } catch (err) {
        await audit({ summary: "Tried to connect the Google account for Google Meetings.", status: 400, outcome: "failed", detail: { error: (err as Error).message } });
        return { result: "failed" };
      }
      const label = { target: account.email, targetLabel: account.email };

      const granted = new Set(account.scope.split(" "));
      if (!GOOGLE_MEETING_SCOPES.filter((s) => s.startsWith("https://")).every((s) => granted.has(s))) {
        await audit({ summary: "Connected a Google account without calendar access.", ...label, status: 400, outcome: "failed", detail: { scope: account.scope } });
        return { result: "scope" };
      }

      const saved = await saveGoogleConnection(actor.id, {
        email: account.email,
        refreshToken: sealSecret(account.refreshToken),
        scope: account.scope,
      });
      if (!saved.ok) {
        await audit({
          summary: "Tried to connect a different Google account while meetings have invites.",
          ...label,
          status: 400,
          outcome: "failed",
          detail: { error: saved.error, current: saved.current },
        });
        return { result: "different_account", extra: { current: saved.current } };
      }
      await audit({ summary: "Connected the Google account Google Meetings sends invites from.", ...label, status: 200, outcome: "succeeded", detail: { replaced: saved.replaced } });
      return { result: "connected" };
    },
  },
};

/**
 * The shared callback, for a state `isConnectState` says is ours. Session-only:
 * it ends in a browser and hands the app a standing token.
 */
export async function handleConnectCallback(req: NextRequest): Promise<Response> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const params = req.nextUrl.searchParams;
  const state = params.get("state");
  const name = purposeOf(state);
  if (!name) return NextResponse.json({ error: "unknown_purpose" }, { status: 400 });
  const purpose = PURPOSES[name];
  if (!purpose.allowed(session.user.access)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!purpose.configured()) return NextResponse.json({ error: "not_configured" }, { status: 503 });

  const back = ({ result, extra }: Outcome) => {
    const to = new URL(purpose.page, appBase(req));
    to.searchParams.set(purpose.param, result);
    for (const [key, value] of Object.entries(extra ?? {})) to.searchParams.set(key, value);
    const res = NextResponse.redirect(to);
    res.cookies.delete({ name: OAUTH_STATE_COOKIE, path: OAUTH_CALLBACK_PATH });
    return res;
  };

  // A provider echoes the state on a refusal too, so check it first.
  if (!stateMatches(state, req.cookies.get(OAUTH_STATE_COOKIE)?.value)) return back({ result: purpose.badState });
  if (params.get("error")) return back({ result: purpose.cancelled });
  const code = params.get("code");
  if (!code) return back({ result: purpose.badState });

  const actor: Actor = { id: session.user.id, email: session.user.email ?? null, name: session.user.name ?? null };
  const ip = await requestIp();
  const audit = (entry: Partial<AuditEntry>) =>
    recordAudit({
      actor,
      via: "session",
      action: purpose.action,
      summary: "",
      path: OAUTH_CALLBACK_PATH,
      outcome: "failed",
      ip,
      ...entry,
    });
  return back(await purpose.complete({ req, code, actor, audit }));
}
