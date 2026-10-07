/**
 * The few Slack Web API calls the cohort channel sync makes, with the bot
 * token from the app's install (`lib/slack-app.ts`), else the one in
 * `SLACK_BOT_TOKEN` (infra/admin/app.tf). Each waits out a 429 for
 * as long as Slack asks, unless that would run past the caller's deadline,
 * when it throws `SlackOutOfTime` so the sync can stop cleanly and pick up on
 * its next run.
 */

import "server-only";
import { installedSlackToken } from "@/lib/slack-app";

const API = "https://slack.com/api";

export class SlackError extends Error {
  constructor(
    readonly method: string,
    readonly error: string,
    /** Slack's whole answer, when there was one: `conversations.invite` lists each refused user in it. */
    readonly body?: Record<string, unknown>,
  ) {
    // A missing scope names the one it needed, which is what an admin must grant.
    const needed = typeof body?.needed === "string" ? ` (needs ${body.needed})` : "";
    super(`Slack ${method} answered ${error}${needed}`);
  }
}

export class SlackOutOfTime extends Error {
  constructor() {
    super("Ran out of time waiting on Slack's rate limit.");
  }
}

/** The installed app's token wins, so installing it replaces a deployment's older bot without a redeploy. */
export async function slackToken(): Promise<string | null> {
  return (await installedSlackToken()) ?? envSlackToken();
}

export function envSlackToken(): string | null {
  return process.env.SLACK_BOT_TOKEN?.trim() || null;
}

export type SlackClient = {
  /** One call; Slack's JSON when `ok`, else a `SlackError` naming Slack's error. */
  call<T = Record<string, unknown>>(method: string, params: Record<string, string>): Promise<T>;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function slackClient(token: string, deadline: number): SlackClient {
  return {
    async call<T>(method: string, params: Record<string, string>): Promise<T> {
      for (;;) {
        if (Date.now() >= deadline) throw new SlackOutOfTime();
        let res: Response;
        try {
          // Every method takes a form body, which keeps one shape for reads and writes.
          res = await fetch(`${API}/${method}`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams(params),
            signal: AbortSignal.timeout(Math.max(1_000, Math.min(30_000, deadline - Date.now()))),
            cache: "no-store",
          });
        } catch (err) {
          const cause = err instanceof Error && err.cause instanceof Error ? err.cause.message : null;
          throw new SlackError(method, `unreachable (${cause ?? (err instanceof Error ? err.message : "fetch failed")})`);
        }
        if (res.status === 429) {
          const wait = (Number(res.headers.get("retry-after")) || 1) * 1_000;
          if (Date.now() + wait >= deadline) throw new SlackOutOfTime();
          await sleep(wait);
          continue;
        }
        const json = (await res.json().catch(() => null)) as ({ ok?: boolean; error?: string } & T) | null;
        if (!json) throw new SlackError(method, `HTTP ${res.status} with no JSON`);
        if (!json.ok) throw new SlackError(method, json.error ?? "unknown_error", json);
        return json;
      }
    },
  };
}
