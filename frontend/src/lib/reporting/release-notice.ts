/**
 * Telling managers a class has been released: one Slack direct message to
 * everyone in the management chain of anyone scored in it, and to each of the
 * Additional Slack Contacts, linking to Reporting → Live Sessions.
 *
 * Each sending is a run, logged a recipient at a time as it goes, so
 * Reporting Settings → Feedback Management can show it while it runs. While
 * Slack is in dry run (Admin Settings → External Connectors), or for a
 * preview, it sends nothing and logs what it would have sent, and to whom.
 * With the test group on, it messages the group's members for that class
 * instead of anyone else. Nothing here fails the release: what went wrong is
 * logged on the run, never thrown.
 */

import "server-only";

import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import {
  employees,
  releaseNoticeMessages,
  releaseNoticeRuns,
  users,
  type ReleaseNoticeAction,
  type ReleaseNoticeStatus,
} from "@/db/schema";
import { getSlackSyncLive, isFatal, resolveSlackUsers } from "@/lib/cohorts/slack-sync";
import { getTestGroup } from "@/lib/cohorts/test-group";
import { slackContactEmails } from "@/lib/evals/slack-contacts";
import type { ReleaseNoticeMessageSort, ReleaseNoticeSort } from "@/lib/list-specs";
import { pageWindow, toPage, type ListQuery, type Page } from "@/lib/paging";
import { orderFor, searchAny } from "@/lib/paging-sql";
import type { ReleaseStage } from "@/lib/reporting/bootcamp-values";
import { releaseNoticeRecipients, releaseNoticeText } from "@/lib/reporting/release-notice-values";
import { SlackError, SlackOutOfTime, slackClient, slackToken, type SlackClient } from "@/lib/slack";
import { SLACK_DM_SCOPES, getSlackInstallation } from "@/lib/slack-app";

/** How long one run may spend messaging. */
const DEADLINE_MS = 90_000;
/** A run still marked running after this died with its server. */
const STALE_MS = 10 * 60_000;

/** Who is told: the managers of `attendees` (lowercased emails) and the Additional Slack Contacts, or the test group's members for `stage`. */
async function recipientsOf(stage: ReleaseStage, attendees: string[]): Promise<{ emails: string[]; testGroup: boolean }> {
  const group = await getTestGroup();
  if (group.on) {
    return {
      emails: group.members.filter((m) => m.stage === stage || m.stage === "both").map((m) => m.email),
      testGroup: true,
    };
  }
  const chains: (string | null)[] = [];
  for (let i = 0; i < attendees.length; i += 500) {
    const rows = await db
      .select({ chain: employees.managementChain })
      .from(employees)
      .where(and(inArray(employees.email, attendees.slice(i, i + 500)), eq(employees.active, true)));
    chains.push(...rows.map((r) => r.chain));
  }
  return { emails: releaseNoticeRecipients(chains, await slackContactEmails()), testGroup: false };
}

export type ReleaseNoticeRequest = {
  stage: ReleaseStage;
  bootcamp: { id: string; startDate: string };
  /** Everyone scored in the class, lowercased. */
  attendees: string[];
  /** Whoever pressed Release or Preview. */
  actorId: string;
  /** Logs what a release would send, without releasing or sending anything. */
  preview: boolean;
  /** Reporting → Live Sessions, which "Click here" links to. */
  reportingUrl: string;
};

/**
 * Starts a run: works out who is told and logs the run as running. `send`
 * then messages them one at a time, logging each, and closes the run; it
 * never throws, so it can run after the response.
 */
export async function startReleaseNotice(
  req: ReleaseNoticeRequest,
): Promise<{ runId: string; dryRun: boolean; send: () => Promise<void> }> {
  const [{ emails, testGroup }, live] = await Promise.all([recipientsOf(req.stage, req.attendees), getSlackSyncLive()]);
  const dryRun = req.preview || !live;
  const [run] = await db
    .insert(releaseNoticeRuns)
    .values({
      stage: req.stage,
      bootcampId: req.bootcamp.id,
      triggeredBy: req.actorId,
      preview: req.preview,
      dryRun,
      testGroup,
      recipients: emails.length,
    })
    .returning({ id: releaseNoticeRuns.id });
  const runId = run!.id;
  const text = releaseNoticeText(req.stage, req.bootcamp.startDate, req.reportingUrl);
  return { runId, dryRun, send: () => sendRun(runId, emails, text, dryRun) };
}

const tally = { messaged: releaseNoticeRuns.messaged, notInSlack: releaseNoticeRuns.notInSlack, failures: releaseNoticeRuns.failures };

/** One recipient's row, and its count on the run, so the log grows as the run goes. */
async function note(runId: string, action: ReleaseNoticeAction, email: string, detail: string | null): Promise<void> {
  await db.insert(releaseNoticeMessages).values({ runId, action, email, detail });
  const column = action === "messaged" ? tally.messaged : action === "not_in_slack" ? tally.notInSlack : tally.failures;
  const key = action === "messaged" ? "messaged" : action === "not_in_slack" ? "notInSlack" : "failures";
  await db
    .update(releaseNoticeRuns)
    .set({ [key]: sql`${column} + 1` })
    .where(eq(releaseNoticeRuns.id, runId));
}

async function finish(runId: string, status: Exclude<ReleaseNoticeStatus, "running">, error: string | null = null): Promise<void> {
  await db.update(releaseNoticeRuns).set({ status, error, finishedAt: new Date() }).where(eq(releaseNoticeRuns.id, runId));
}

/** Why a live run cannot reach Slack at all, or null when it can. */
async function unreachable(token: string | null): Promise<string | null> {
  if (!token) return "Slack is not connected. A platform administrator adds the app on Admin Settings → External Connectors.";
  const installation = await getSlackInstallation();
  const missing = installation?.readable ? SLACK_DM_SCOPES.filter((s) => !installation.scopes.includes(s)) : [];
  return missing.length > 0 ? `The Slack app is missing ${missing.join(", ")}. Add it again to grant them.` : null;
}

async function sendRun(runId: string, emails: string[], text: string, dryRun: boolean): Promise<void> {
  try {
    const token = await slackToken();
    if (!dryRun) {
      const why = await unreachable(token);
      if (why) return await finish(runId, "failed", why);
    }
    // A dry run with Slack connected still asks who has an account; without it, it takes it that everyone does.
    const slack: SlackClient | null = token ? slackClient(token, Date.now() + DEADLINE_MS) : null;
    const ids = slack ? await resolveSlackUsers(slack, emails) : new Map(emails.map((e) => [e, e]));
    for (const email of emails) {
      const user = ids.get(email);
      if (!user) {
        await note(runId, "not_in_slack", email, null);
        continue;
      }
      if (dryRun || !slack) {
        await note(runId, "messaged", email, text);
        continue;
      }
      try {
        const { channel } = await slack.call<{ channel: { id: string } }>("conversations.open", { users: user });
        await slack.call("chat.postMessage", { channel: channel.id, text, unfurl_links: "false" });
        await note(runId, "messaged", email, text);
      } catch (err) {
        if (!(err instanceof SlackError) || isFatal(err)) throw err;
        await note(runId, "failed", email, err.error);
      }
    }
    await finish(runId, "succeeded");
  } catch (err) {
    const error =
      err instanceof SlackOutOfTime
        ? "Ran out of time waiting on Slack's rate limit; the rest were not messaged."
        : err instanceof SlackError
          ? err.message
          : "Something went wrong on the server.";
    if (!(err instanceof SlackError) && !(err instanceof SlackOutOfTime)) console.error("release notice failed", err);
    await finish(runId, "failed", error).catch(() => undefined);
  }
}

/* ------------------------------------------------------------------ */
/* The log                                                             */
/* ------------------------------------------------------------------ */

export type ReleaseNoticeRun = {
  id: string;
  stage: ReleaseStage;
  triggeredBy: string | null;
  preview: boolean;
  dryRun: boolean;
  testGroup: boolean;
  status: ReleaseNoticeStatus;
  startedAt: Date;
  finishedAt: Date | null;
  recipients: number;
  messaged: number;
  notInSlack: number;
  failures: number;
  error: string | null;
};

const r = releaseNoticeRuns;
const runColumns = {
  id: r.id,
  stage: r.stage,
  triggeredByName: users.name,
  triggeredByEmail: users.email,
  preview: r.preview,
  dryRun: r.dryRun,
  testGroup: r.testGroup,
  status: r.status,
  startedAt: r.startedAt,
  finishedAt: r.finishedAt,
  recipients: r.recipients,
  messaged: r.messaged,
  notInSlack: r.notInSlack,
  failures: r.failures,
  error: r.error,
};

type RunRow = { triggeredByName: string | null; triggeredByEmail: string | null } & Omit<ReleaseNoticeRun, "triggeredBy">;

function summarize({ triggeredByName, triggeredByEmail, ...rest }: RunRow): ReleaseNoticeRun {
  return {
    ...rest,
    triggeredBy: triggeredByName ?? triggeredByEmail,
    ...(rest.status === "running" && rest.startedAt.getTime() < Date.now() - STALE_MS
      ? { status: "failed" as const, error: "Did not finish — the server stopped mid-run." }
      : {}),
  };
}

const RUN_SORT_COLUMNS = {
  startedAt: r.startedAt,
  triggeredBy: sql`lower(coalesce(nullif(${users.name}, ''), ${users.email}))`,
  stage: r.stage,
  status: r.status,
} as const;

/** One page of the log, newest first unless asked otherwise. The search matches who started it, the class, the status and the error. */
export async function listReleaseNotices(query: ListQuery<ReleaseNoticeSort>): Promise<Page<ReleaseNoticeRun>> {
  const { limit, offset } = pageWindow(query.page);
  const rows = await db
    .select(runColumns)
    .from(r)
    .leftJoin(users, eq(users.id, r.triggeredBy))
    .where(searchAny(query.q, [users.name, users.email, r.stage, r.status, r.error]))
    .orderBy(...orderFor(RUN_SORT_COLUMNS[query.sort], query.dir, desc(r.startedAt), r.id))
    .limit(limit)
    .offset(offset);
  return toPage(rows.map(summarize), query.page);
}

/** One run, or null. */
export async function getReleaseNotice(id: string): Promise<ReleaseNoticeRun | null> {
  const [row] = await db.select(runColumns).from(r).leftJoin(users, eq(users.id, r.triggeredBy)).where(eq(r.id, id));
  return row ? summarize(row) : null;
}

export type ReleaseNoticeMessageRow = {
  id: string;
  action: ReleaseNoticeAction;
  email: string;
  fullName: string | null;
  detail: string | null;
  at: Date;
};

/** Which of a run's rows to list: the messages sent, or what went wrong. */
export const RELEASE_NOTICE_KINDS = ["messages", "problems"] as const;
export type ReleaseNoticeKind = (typeof RELEASE_NOTICE_KINDS)[number];

export function isReleaseNoticeKind(value: unknown): value is ReleaseNoticeKind {
  return RELEASE_NOTICE_KINDS.includes(value as ReleaseNoticeKind);
}

const m = releaseNoticeMessages;
const OF_KIND: Record<ReleaseNoticeKind, SQL> = {
  messages: eq(m.action, "messaged"),
  problems: inArray(m.action, ["failed", "not_in_slack"]),
};

/** How many of a run's rows are of each kind, whatever the search. */
export async function countReleaseNoticeMessages(runId: string): Promise<Record<ReleaseNoticeKind | "all", number>> {
  const [row] = await db
    .select({
      all: sql<number>`count(*)::int`,
      messages: sql<number>`count(*) filter (where ${OF_KIND.messages})::int`,
      problems: sql<number>`count(*) filter (where ${OF_KIND.problems})::int`,
    })
    .from(m)
    .where(eq(m.runId, runId));
  return row ?? { all: 0, messages: 0, problems: 0 };
}

const MESSAGE_SORT_COLUMNS = { at: m.at, action: m.action, email: m.email } as const;

/** One page of a run's recipients, only of one kind when `kind` is given. The search matches the email, the name, the action or the detail. */
export async function listReleaseNoticeMessages(
  runId: string,
  query: ListQuery<ReleaseNoticeMessageSort>,
  kind: ReleaseNoticeKind | null = null,
): Promise<Page<ReleaseNoticeMessageRow>> {
  const { limit, offset } = pageWindow(query.page);
  // Qualified by hand, as in listSlackSyncChanges: a bare "email" inside the subquery would mean e.email.
  const fullName = sql<string | null>`(select e.full_name from employees e where lower(e.email) = "release_notice_messages"."email" limit 1)`;
  const rows = await db
    .select({ id: m.id, action: m.action, email: m.email, fullName, detail: m.detail, at: m.at })
    .from(m)
    .where(and(eq(m.runId, runId), kind ? OF_KIND[kind] : undefined, searchAny(query.q, [m.email, m.action, m.detail, fullName])))
    .orderBy(...orderFor(MESSAGE_SORT_COLUMNS[query.sort], query.dir, m.at, m.id))
    .limit(limit)
    .offset(offset);
  return toPage(rows, query.page);
}
