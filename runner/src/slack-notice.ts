import { openSecret } from "./secret-box.js";
import {
  adminContacts,
  cachedSlackChannel,
  forgetSlackChannel,
  log,
  recordRunAudit,
  runNoticeContext,
  saveSlackChannel,
  slackInstallationToken,
  slackLive,
} from "./db.js";

/**
 * Telling people how a build is going, in Slack: the creator when it starts and
 * when it is ready, and the administrators' private channel when it fails.
 *
 * Nothing here may cost a build anything. Every send is best-effort, bounded in
 * time, and logged on the run rather than thrown, so a Slack that is down, an
 * app that was never installed or a person who is not in the workspace changes
 * nothing about the workshop. Slack stays in dry run until someone turns it
 * live on Admin Settings → External Connectors; QA shares production's
 * workspace, so there a notice is only logged.
 */

/** The private channel the administrators are gathered in to hear about failures. */
export const ADMIN_CHANNEL = "val-admin-team";

/** All the time one notice may spend on Slack, rate limits included. */
const DEADLINE_MS = 30_000;

export type BuildNotice = "started" | "ready" | "failed";

export type Admin = { email: string; name: string | null; slackUserId: string | null };

/** The app's own address, which the links in a notice are built from; null when the runner was not told it. */
export function appUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const url = (env.APP_URL || env.AUTH_URL || "").trim().replace(/\/+$/, "");
  return url || null;
}

/** The build page: the run, its log and its error. */
export function buildPageUrl(base: string, runId: string): string {
  return `${base}/runs/${runId}`;
}

/** The page attendees open to claim their accounts, which is what a creator shares. */
export function userPageUrl(base: string, runId: string): string {
  return `${base}/attend/${runId}`;
}

/** Slack treats these three as markup in a message's text. */
export function escapeSlack(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function startedText(workshop: string, buildUrl: string): string {
  return `:construction: Setup is underway for your workshop *${escapeSlack(workshop)}*. Follow the build here: <${buildUrl}|build page>`;
}

export function readyText(workshop: string, userUrl: string): string {
  return `:white_check_mark: Your workshop *${escapeSlack(workshop)}* is ready. Attendees claim their accounts here: <${userUrl}|workshop user page>`;
}

/**
 * The alert for the administrators' channel. Each administrator with a Slack
 * account is tagged; one without is named instead, so nobody drops out of the
 * message silently. The error itself stays on the build page, which is where a
 * link to it leads, and out of a channel that is wider than the run.
 */
export function failedText(workshop: string, creator: string | null, admins: Admin[], buildUrl: string): string {
  const tags = admins.filter((a) => a.slackUserId).map((a) => `<@${a.slackUserId}>`);
  const untagged = admins.filter((a) => !a.slackUserId).map((a) => escapeSlack(a.name ?? a.email));
  const by = creator ? ` created by ${escapeSlack(creator)}` : "";
  return [
    `:rotating_light: ${tags.join(" ")}`.trimEnd(),
    `The build of workshop *${escapeSlack(workshop)}*${by} failed. See what went wrong on the <${buildUrl}|failed build page>.`,
    ...(untagged.length ? [`Not in Slack, so not tagged: ${untagged.join(", ")}.`] : []),
  ].join("\n");
}

/* ------------------------------------------------------------------ */
/* Slack                                                               */
/* ------------------------------------------------------------------ */

class SlackFailure extends Error {
  constructor(
    readonly method: string,
    readonly error: string,
  ) {
    super(`Slack ${method} answered ${error}`);
  }
}

type Call = <T = Record<string, unknown>>(method: string, params: Record<string, string>) => Promise<T>;

/** One Web API call as the bot, waiting out a rate limit unless that would pass the deadline. */
function caller(token: string, deadline: number): Call {
  return async <T>(method: string, params: Record<string, string>): Promise<T> => {
    for (;;) {
      if (Date.now() >= deadline) throw new SlackFailure(method, "out_of_time");
      let res: Response;
      try {
        res = await fetch(`https://slack.com/api/${method}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams(params),
          signal: AbortSignal.timeout(Math.max(1_000, Math.min(15_000, deadline - Date.now()))),
        });
      } catch (err) {
        throw new SlackFailure(method, `unreachable (${err instanceof Error ? err.message : "fetch failed"})`);
      }
      if (res.status === 429) {
        const wait = (Number(res.headers.get("retry-after")) || 1) * 1_000;
        if (Date.now() + wait >= deadline) throw new SlackFailure(method, "rate_limited");
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      const json = (await res.json().catch(() => null)) as ({ ok?: boolean; error?: string } & T) | null;
      if (!json) throw new SlackFailure(method, `HTTP ${res.status} with no JSON`);
      if (!json.ok) throw new SlackFailure(method, json.error ?? "unknown_error");
      return json;
    }
  };
}

async function lookupUser(call: Call, email: string): Promise<string | null> {
  try {
    const { user } = await call<{ user: { id: string; deleted?: boolean } }>("users.lookupByEmail", { email });
    return user.deleted ? null : user.id;
  } catch (err) {
    if (err instanceof SlackFailure && err.error === "users_not_found") return null;
    throw err;
  }
}

type Page = { response_metadata?: { next_cursor?: string } };

async function memberIds(call: Call, channel: string): Promise<Set<string>> {
  const members = new Set<string>();
  let cursor = "";
  do {
    const page = await call<{ members: string[] } & Page>("conversations.members", {
      channel,
      limit: "1000",
      ...(cursor ? { cursor } : {}),
    });
    for (const m of page.members) members.add(m);
    cursor = page.response_metadata?.next_cursor ?? "";
  } while (cursor);
  return members;
}

/** A private channel the bot is in, by name; the API lists no private channel it has not been added to. */
async function findPrivateChannel(call: Call, name: string): Promise<string | null> {
  let cursor = "";
  do {
    const page = await call<{ channels: { id: string; name: string }[] } & Page>("conversations.list", {
      types: "private_channel",
      exclude_archived: "true",
      limit: "1000",
      ...(cursor ? { cursor } : {}),
    });
    const hit = page.channels.find((c) => c.name === name);
    if (hit) return hit.id;
    cursor = page.response_metadata?.next_cursor ?? "";
  } while (cursor);
  return null;
}

/** The administrators' channel, made private if it does not exist, with the bot in it. */
async function ensureAdminChannel(call: Call): Promise<string> {
  const stored = await cachedSlackChannel(ADMIN_CHANNEL);
  if (stored) {
    try {
      const { channel } = await call<{ channel: { is_archived?: boolean } }>("conversations.info", { channel: stored });
      if (!channel.is_archived) return stored;
    } catch (err) {
      if (!(err instanceof SlackFailure) || err.error !== "channel_not_found") throw err;
    }
    await forgetSlackChannel(ADMIN_CHANNEL);
  }

  const found = await findPrivateChannel(call, ADMIN_CHANNEL);
  if (found) {
    await saveSlackChannel(ADMIN_CHANNEL, found, false);
    return found;
  }
  try {
    const { channel } = await call<{ channel: { id: string } }>("conversations.create", {
      name: ADMIN_CHANNEL,
      is_private: "true",
    });
    await saveSlackChannel(ADMIN_CHANNEL, channel.id, true);
    return channel.id;
  } catch (err) {
    if (err instanceof SlackFailure && err.error === "name_taken") {
      throw new Error(`${ADMIN_CHANNEL} exists, but the bot is not in it: add the Slack app to it`);
    }
    throw err;
  }
}

/** Puts every administrator with a Slack account in the channel, leaving anyone already there. */
async function gather(call: Call, channel: string, admins: Admin[]): Promise<void> {
  const present = await memberIds(call, channel);
  const missing = admins.flatMap((a) => (a.slackUserId && !present.has(a.slackUserId) ? [a.slackUserId] : []));
  for (let i = 0; i < missing.length; i += 1000) {
    await call("conversations.invite", { channel, users: missing.slice(i, i + 1000).join(","), force: "true" });
  }
}

async function botToken(): Promise<string | null> {
  const sealed = await slackInstallationToken();
  if (sealed) return openSecret(sealed);
  return process.env.SLACK_BOT_TOKEN?.trim() || null;
}

/* ------------------------------------------------------------------ */
/* The notices                                                         */
/* ------------------------------------------------------------------ */

async function send(runId: string, kind: BuildNotice): Promise<string> {
  const base = appUrl();
  if (!base) return "no APP_URL, so there is no page to link to";
  const run = await runNoticeContext(runId);
  if (!run) return "the run is gone";

  const live = await slackLive();
  const token = await botToken();
  if (!token) return "Slack is not connected";
  const call = caller(token, Date.now() + DEADLINE_MS);

  if (kind === "failed") {
    const admins: Admin[] = [];
    const contacts = await adminContacts();
    if (!live) return `Slack is in dry run; would have alerted ${contacts.length} administrator(s) in ${ADMIN_CHANNEL}`;
    for (const c of contacts) {
      admins.push({ ...c, slackUserId: await lookupUser(call, c.email) });
    }
    const channel = await ensureAdminChannel(call);
    await gather(call, channel, admins);
    await call("chat.postMessage", {
      channel,
      text: failedText(run.name, run.creatorName ?? run.creatorEmail, admins, buildPageUrl(base, runId)),
      unfurl_links: "false",
    });
    return `alerted ${admins.length} administrator(s) in ${ADMIN_CHANNEL}`;
  }

  if (!run.creatorEmail) return "the creator has no email address";
  if (!live) return `Slack is in dry run; would have messaged ${run.creatorEmail}`;
  const id = await lookupUser(call, run.creatorEmail);
  if (!id) return `${run.creatorEmail} is not in Slack`;
  // A user id opens the bot's direct message with them.
  await call("chat.postMessage", {
    channel: id,
    text: kind === "started" ? startedText(run.name, buildPageUrl(base, runId)) : readyText(run.name, userPageUrl(base, runId)),
    unfurl_links: "false",
  });
  return `messaged ${run.creatorEmail}`;
}

/**
 * Sends one notice about a run and records how it went on the run's log and
 * audit trail. Never throws.
 */
export async function notifyBuild(runId: string, kind: BuildNotice): Promise<void> {
  const action = `runner.slack.${kind}`;
  try {
    const outcome = await send(runId, kind);
    await log(runId, "system", `Slack (${kind}): ${outcome}`);
    await recordRunAudit(runId, action, `Slack notice: ${outcome}.`, "succeeded", { kind });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`slack notice ${kind} for ${runId}:`, err);
    await log(runId, "system", `Slack (${kind}) failed: ${message}`).catch(() => {});
    await recordRunAudit(runId, action, "Could not send a Slack notice.", "failed", { kind, error: message }).catch(() => {});
  }
}
