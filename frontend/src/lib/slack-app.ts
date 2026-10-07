/**
 * The Slack app the cohort channel sync acts as, and its install in the
 * workspace. `SLACK_APP_CLIENT_ID` and `SLACK_APP_CLIENT_SECRET` let an
 * administrator press Add to Slack on Cohort Settings → Slack; Slack's OAuth
 * v2 flow sends them back to the shared callback (`lib/oauth-callback.ts`) with
 * a code, which is traded here for the bot token and sealed into
 * `slack_installation`.
 */

import "server-only";
import { eq, getTableColumns } from "drizzle-orm";
import { db } from "@/db";
import { slackInstallation, users } from "@/db/schema";
import { openSecret, sealSecret } from "@/lib/secret-box";

/** What the channel sync calls; see `lib/cohorts/slack-sync.ts`. */
export const SLACK_BOT_SCOPES = [
  "users:read",
  "users:read.email",
  "channels:read",
  "channels:manage",
  "channels:join",
] as const;

export type SlackApp = { appId: string | null; clientId: string; clientSecret: string };

/** The app's OAuth credentials, or null when this deployment has none and so cannot offer Add to Slack. */
export function slackApp(): SlackApp | null {
  const clientId = process.env.SLACK_APP_CLIENT_ID?.trim();
  const clientSecret = process.env.SLACK_APP_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return { appId: process.env.SLACK_APP_ID?.trim() || null, clientId, clientSecret };
}

export function slackAuthorizeUrl(app: SlackApp, redirectUri: string, state: string): string {
  const url = new URL("https://slack.com/oauth/v2/authorize");
  url.searchParams.set("client_id", app.clientId);
  url.searchParams.set("scope", SLACK_BOT_SCOPES.join(","));
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  return url.toString();
}

type Granted = {
  token: string;
  teamId: string;
  teamName: string | null;
  appId: string;
  botUserId: string;
  scopes: string;
};

/** Trades the callback's code for the bot token; `error` is Slack's own, such as `invalid_code`. */
export async function exchangeSlackCode(
  app: SlackApp,
  code: string,
  redirectUri: string,
): Promise<{ ok: true; granted: Granted } | { ok: false; error: string }> {
  let json: Record<string, unknown> | null;
  try {
    const res = await fetch("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: app.clientId,
        client_secret: app.clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!json) return { ok: false, error: `HTTP ${res.status} with no JSON` };
  } catch {
    return { ok: false, error: "unreachable" };
  }
  if (!json.ok) return { ok: false, error: typeof json.error === "string" ? json.error : "unknown_error" };

  const team = (json.team ?? {}) as { id?: string; name?: string };
  const token = json.access_token;
  if (json.token_type !== "bot" || typeof token !== "string" || !team.id || typeof json.bot_user_id !== "string") {
    return { ok: false, error: "no_bot_token" };
  }
  // A Client ID from another app would install that app instead.
  if (app.appId && json.app_id !== app.appId) return { ok: false, error: "wrong_app" };

  return {
    ok: true,
    granted: {
      token,
      teamId: team.id,
      teamName: team.name ?? null,
      appId: String(json.app_id ?? app.appId ?? ""),
      botUserId: json.bot_user_id,
      scopes: typeof json.scope === "string" ? json.scope : "",
    },
  };
}

/** Replaces any earlier install. */
export async function saveSlackInstallation(actorId: string, granted: Granted): Promise<void> {
  const { token, ...rest } = granted;
  const row = { ...rest, token: sealSecret(token), installedBy: actorId, installedAt: new Date() };
  await db
    .insert(slackInstallation)
    .values({ id: true, ...row })
    .onConflictDoUpdate({ target: slackInstallation.id, set: row });
}

/** Forgets the token here. The app stays installed in Slack, where an admin removes it. */
export async function deleteSlackInstallation(): Promise<boolean> {
  const gone = await db.delete(slackInstallation).returning({ id: slackInstallation.id });
  return gone.length > 0;
}

export type SlackInstallationSummary = {
  teamId: string;
  teamName: string | null;
  appId: string;
  botUserId: string;
  scopes: string[];
  /** Scopes the sync needs that the install did not grant. */
  missingScopes: string[];
  /** False when the token was sealed with another deployment's key, as after an import. */
  readable: boolean;
  installedBy: string | null;
  installedAt: Date;
};

/** The install, without its token. */
export async function getSlackInstallation(): Promise<SlackInstallationSummary | null> {
  const [row] = await db
    .select({
      ...getTableColumns(slackInstallation),
      installedByName: users.name,
      installedByEmail: users.email,
    })
    .from(slackInstallation)
    .leftJoin(users, eq(users.id, slackInstallation.installedBy));
  if (!row) return null;
  const scopes = row.scopes.split(",").map((s) => s.trim()).filter(Boolean);
  return {
    teamId: row.teamId,
    teamName: row.teamName,
    appId: row.appId,
    botUserId: row.botUserId,
    scopes,
    missingScopes: SLACK_BOT_SCOPES.filter((s) => !scopes.includes(s)),
    readable: openSecret(row.token) !== null,
    installedBy: row.installedByName ?? row.installedByEmail ?? null,
    installedAt: row.installedAt,
  };
}

/** The installed bot's token, or null with no install or one this deployment cannot open. */
export async function installedSlackToken(): Promise<string | null> {
  const [row] = await db.select({ token: slackInstallation.token }).from(slackInstallation);
  return row ? openSecret(row.token) : null;
}
