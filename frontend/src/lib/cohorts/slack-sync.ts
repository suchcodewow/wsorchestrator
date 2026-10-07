/**
 * The cohort Slack channel sync: while a bootcamp is active in the Scheduler,
 * puts everyone on the Cohorts page's Current tab, and the Additional Channel
 * Contacts, in that bootcamp's channels (see `slack-plan.ts` for which), and
 * takes out anyone it invited who no longer belongs. Someone it did not
 * invite is never removed. It runs after each scheduled HiBob sync, and from
 * Cohort Settings' Slack tab.
 *
 * Until an administrator turns it live, every run is a dry run: it reads
 * Slack and logs what it would do, but invites, removes and creates nothing.
 * QA shares production's Slack workspace, so QA stays in dry run, or has no
 * token at all.
 *
 * A run has a deadline. Slack's rate limits can make a first run, which looks
 * up every email, take longer than a request may; it then stops, marked
 * unfinished, and the next run carries on from what it has already stored.
 */

import "server-only";

import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  EVALS_SETTINGS_KEYS,
  evalsSettings,
  slackChannelMembers,
  slackChannels,
  slackSyncChanges,
  slackSyncRuns,
  slackUsers,
  users,
  type SlackSyncAction,
  type SlackSyncStatus,
  type SlackSyncTrigger,
} from "@/db/schema";
import { allChannelContacts } from "@/lib/cohorts/channel-contacts";
import {
  channelAudience,
  cohortChannels,
  planMembership,
  type CohortChannel,
  type CohortChannelKind,
} from "@/lib/cohorts/slack-plan";
import { currentCohortEmails } from "@/lib/evals/current-cohort";
import type { SlackSyncChangeSort, SlackSyncSort } from "@/lib/list-specs";
import { pageWindow, toPage, type ListQuery, type Page } from "@/lib/paging";
import { orderFor, searchAny } from "@/lib/paging-sql";
import { activeBootcamp } from "@/lib/scheduler/bootcamps";
import { SlackError, SlackOutOfTime, slackClient, slackToken, type SlackClient } from "@/lib/slack";

/** A run still marked running after this was cut off. */
const STALE_MS = 10 * 60_000;
/** How long an email Slack had no account for goes before it is asked about again. */
const NOT_FOUND_RETRY_MS = 24 * 60 * 60_000;
/** `conversations.invite` takes up to 1,000 users at once. */
const INVITE_BATCH = 1_000;

/* ------------------------------------------------------------------ */
/* Live or dry run                                                     */
/* ------------------------------------------------------------------ */

/** Whether the sync may change Slack; false, a dry run, until someone says otherwise. */
export async function getSlackSyncLive(): Promise<boolean> {
  const [row] = await db
    .select({ value: evalsSettings.value })
    .from(evalsSettings)
    .where(eq(evalsSettings.key, EVALS_SETTINGS_KEYS.slackSyncLive));
  return row?.value === "true";
}

export async function setSlackSyncLive(actorId: string, live: boolean): Promise<void> {
  const value = live ? "true" : "false";
  await db
    .insert(evalsSettings)
    .values({ key: EVALS_SETTINGS_KEYS.slackSyncLive, value, updatedBy: actorId })
    .onConflictDoUpdate({
      target: evalsSettings.key,
      set: { value, updatedBy: actorId, updatedAt: new Date() },
    });
}

/* ------------------------------------------------------------------ */
/* The run log                                                         */
/* ------------------------------------------------------------------ */

export type SlackSyncError = "not_configured" | "already_running" | "slack_error";

export const STATUS_FOR: Record<SlackSyncError, number> = {
  not_configured: 409,
  already_running: 409,
  slack_error: 502,
};

const LOGGED: Record<Exclude<SlackSyncError, "already_running">, string> = {
  not_configured: "Slack is not connected — add the app to Slack on Cohort Settings → Slack.",
  slack_error: "Slack refused the sync.",
};

async function closeStaleRuns(): Promise<void> {
  await db
    .update(slackSyncRuns)
    .set({ status: "failed", finishedAt: new Date(), error: "Did not finish — the server stopped mid-sync." })
    .where(and(eq(slackSyncRuns.status, "running"), lt(slackSyncRuns.startedAt, new Date(Date.now() - STALE_MS))));
}

/** Opens a run, or null if one is already running — the partial unique index allows one. */
async function startRun(trigger: SlackSyncTrigger, actorId: string | null, dryRun: boolean): Promise<string | null> {
  await closeStaleRuns();
  const [run] = await db
    .insert(slackSyncRuns)
    .values({ trigger, triggeredBy: actorId, dryRun })
    .onConflictDoNothing()
    .returning({ id: slackSyncRuns.id });
  return run?.id ?? null;
}

type Tally = { invited: number; removed: number; notInSlack: number; failures: number };

type ChangeRow = { channelName: string; action: SlackSyncAction; email?: string; detail?: string | null };

/** What a run has done so far, written out a channel at a time so a cut-off run still shows its work. */
class RunLog {
  readonly tally: Tally = { invited: 0, removed: 0, notInSlack: 0, failures: 0 };
  private pending: ChangeRow[] = [];
  constructor(readonly runId: string) {}

  note(row: ChangeRow): void {
    this.pending.push(row);
    if (row.action === "invited") this.tally.invited++;
    else if (row.action === "removed") this.tally.removed++;
    else if (row.action === "not_in_slack") this.tally.notInSlack++;
    else if (row.action === "failed") this.tally.failures++;
  }

  async flush(): Promise<void> {
    const rows = this.pending;
    this.pending = [];
    for (let i = 0; i < rows.length; i += 500) {
      await db.insert(slackSyncChanges).values(
        rows.slice(i, i + 500).map((r) => ({
          runId: this.runId,
          channelName: r.channelName,
          action: r.action,
          email: r.email ?? "",
          detail: r.detail ?? null,
        })),
      );
    }
  }
}

async function finishRun(
  runId: string,
  status: Exclude<SlackSyncStatus, "running">,
  fields: Partial<Tally> & { unfinished?: boolean; error?: string | null; bootcampId?: string | null },
): Promise<void> {
  await db
    .update(slackSyncRuns)
    .set({ status, finishedAt: new Date(), ...fields })
    .where(eq(slackSyncRuns.id, runId));
}

/* ------------------------------------------------------------------ */
/* Slack lookups                                                       */
/* ------------------------------------------------------------------ */

/**
 * Each email's Slack user id, or null for one Slack has no active account for.
 * Read from `slack_users` where it can be, asking Slack only for the rest; each
 * answer is stored as it comes, so a run cut off part-way keeps its progress.
 */
async function resolveSlackUsers(slack: SlackClient, emails: string[]): Promise<Map<string, string | null>> {
  const known = new Map<string, { id: string | null; at: Date }>();
  for (let i = 0; i < emails.length; i += 500) {
    const rows = await db
      .select()
      .from(slackUsers)
      .where(inArray(slackUsers.email, emails.slice(i, i + 500)));
    for (const r of rows) known.set(r.email, { id: r.slackUserId, at: r.lookedUpAt });
  }

  const retryBefore = Date.now() - NOT_FOUND_RETRY_MS;
  const ids = new Map<string, string | null>();
  for (const email of emails) {
    const cached = known.get(email);
    if (cached && (cached.id || cached.at.getTime() > retryBefore)) {
      ids.set(email, cached.id);
      continue;
    }
    let id: string | null;
    try {
      const { user } = await slack.call<{ user: { id: string; deleted?: boolean } }>("users.lookupByEmail", { email });
      id = user.deleted ? null : user.id;
    } catch (err) {
      if (err instanceof SlackError && err.error === "users_not_found") id = null;
      else throw err;
    }
    await db
      .insert(slackUsers)
      .values({ email, slackUserId: id, lookedUpAt: new Date() })
      .onConflictDoUpdate({ target: slackUsers.email, set: { slackUserId: id, lookedUpAt: new Date() } });
    ids.set(email, id);
  }
  return ids;
}

type ListedChannel = { id: string; name: string; is_member?: boolean; is_archived?: boolean };

/** The unarchived public channels among `names`, by name, from one pass over the workspace's list. */
async function findChannels(slack: SlackClient, names: readonly string[]): Promise<Map<string, ListedChannel>> {
  const wanted = new Set(names);
  const found = new Map<string, ListedChannel>();
  let cursor = "";
  do {
    const page = await slack.call<{ channels: ListedChannel[]; response_metadata?: { next_cursor?: string } }>(
      "conversations.list",
      { types: "public_channel", exclude_archived: "true", limit: "1000", ...(cursor ? { cursor } : {}) },
    );
    for (const ch of page.channels) if (wanted.has(ch.name)) found.set(ch.name, ch);
    cursor = page.response_metadata?.next_cursor ?? "";
  } while (cursor && found.size < wanted.size);
  return found;
}

/** Everyone in a channel, by Slack user id. */
async function channelMembers(slack: SlackClient, channelId: string): Promise<Set<string>> {
  const members = new Set<string>();
  let cursor = "";
  do {
    const page = await slack.call<{ members: string[]; response_metadata?: { next_cursor?: string } }>(
      "conversations.members",
      { channel: channelId, limit: "1000", ...(cursor ? { cursor } : {}) },
    );
    for (const m of page.members) members.add(m);
    cursor = page.response_metadata?.next_cursor ?? "";
  } while (cursor);
  return members;
}

/**
 * Each channel's id, the bot in it: the stored id while Slack still has it
 * unarchived, else the channel of that name, else a new one. In a dry run
 * nothing is created or joined, and a channel still to be created has a null
 * id. A channel Slack refuses is logged and left out.
 */
async function ensureChannels(
  slack: SlackClient,
  channels: readonly CohortChannel[],
  dryRun: boolean,
  log: RunLog,
): Promise<Map<string, string | null>> {
  const names = channels.map((c) => c.name);
  const stored = new Map(
    (await db.select().from(slackChannels).where(inArray(slackChannels.name, names))).map((r) => [r.name, r]),
  );

  const ids = new Map<string, string | null>();
  const isMember = new Map<string, boolean>();
  const toFind: string[] = [];

  for (const name of names) {
    const row = stored.get(name);
    if (!row) {
      toFind.push(name);
      continue;
    }
    try {
      const { channel } = await slack.call<{ channel: ListedChannel }>("conversations.info", {
        channel: row.slackChannelId,
      });
      if (channel.is_archived) throw new SlackError("conversations.info", "is_archived");
      ids.set(name, channel.id);
      isMember.set(name, channel.is_member ?? false);
    } catch (err) {
      if (!(err instanceof SlackError) || !["channel_not_found", "is_archived"].includes(err.error)) throw err;
      // Deleted or archived since: find, or make, another of that name.
      await db.delete(slackChannels).where(eq(slackChannels.name, name));
      toFind.push(name);
    }
  }

  // Creating first saves listing the whole workspace when the name is free.
  const toList: string[] = [];
  for (const name of toFind) {
    if (dryRun) {
      toList.push(name);
      continue;
    }
    try {
      const { channel } = await slack.call<{ channel: ListedChannel }>("conversations.create", {
        name,
        is_private: "false",
      });
      await db.insert(slackChannels).values({ name, slackChannelId: channel.id, created: true }).onConflictDoNothing();
      log.note({ channelName: name, action: "created" });
      ids.set(name, channel.id);
      isMember.set(name, true);
    } catch (err) {
      if (err instanceof SlackError && err.error === "name_taken") toList.push(name);
      else if (err instanceof SlackError && !isFatal(err)) log.note({ channelName: name, action: "failed", detail: err.error });
      else throw err;
    }
  }

  if (toList.length > 0) {
    const found = await findChannels(slack, toList);
    for (const name of toList) {
      const ch = found.get(name);
      if (ch) {
        await db.insert(slackChannels).values({ name, slackChannelId: ch.id }).onConflictDoNothing();
        ids.set(name, ch.id);
        isMember.set(name, ch.is_member ?? false);
      } else if (dryRun) {
        log.note({ channelName: name, action: "created" });
        ids.set(name, null);
      } else {
        // Taken, yet not among the unarchived public channels.
        log.note({
          channelName: name,
          action: "failed",
          detail: "A private or archived channel already has this name; rename it, or make it public and unarchive it.",
        });
      }
    }
  }

  for (const [name, id] of ids) {
    if (!id || isMember.get(name)) continue;
    if (dryRun) {
      log.note({ channelName: name, action: "joined" });
      continue;
    }
    try {
      await slack.call("conversations.join", { channel: id });
      log.note({ channelName: name, action: "joined" });
    } catch (err) {
      if (!(err instanceof SlackError) || isFatal(err)) throw err;
      log.note({ channelName: name, action: "failed", detail: `Could not join: ${err.error}` });
      ids.delete(name);
    }
  }
  return ids;
}

/** Errors that would fail every call alike, so the whole run stops rather than logging one per person. */
function isFatal(err: SlackError): boolean {
  return [
    "invalid_auth",
    "not_authed",
    "account_inactive",
    "token_revoked",
    "token_expired",
    "missing_scope",
    "not_allowed_token_type",
  ].includes(err.error) || err.error.startsWith("unreachable");
}

/** Brings one channel's membership in line, or in a dry run logs what that would take. */
async function syncChannel(
  slack: SlackClient,
  channel: CohortChannel,
  channelId: string | null,
  wanted: Map<string, string>,
  dryRun: boolean,
  log: RunLog,
): Promise<void> {
  // A channel a dry run would create starts empty: everyone wanted would be invited.
  if (!channelId) {
    for (const email of [...wanted.values()].sort()) log.note({ channelName: channel.name, action: "invited", email });
    return;
  }

  const [members, invitedRows] = await Promise.all([
    channelMembers(slack, channelId),
    db.select().from(slackChannelMembers).where(eq(slackChannelMembers.slackChannelId, channelId)),
  ]);
  const invitedBySync = new Map(invitedRows.map((r) => [r.slackUserId, r.email]));
  const plan = planMembership({ wanted: new Set(wanted.keys()), members, invitedBySync: new Set(invitedBySync.keys()) });
  const emailOf = (id: string) => wanted.get(id) ?? invitedBySync.get(id) ?? "";

  if (dryRun) {
    for (const id of plan.invite) log.note({ channelName: channel.name, action: "invited", email: emailOf(id) });
    for (const id of plan.remove) log.note({ channelName: channel.name, action: "removed", email: emailOf(id) });
    return;
  }

  // Forgotten first, so someone who left and is invited again is remembered afresh.
  if (plan.forget.length > 0) {
    await db
      .delete(slackChannelMembers)
      .where(and(eq(slackChannelMembers.slackChannelId, channelId), inArray(slackChannelMembers.slackUserId, plan.forget)));
  }

  for (let i = 0; i < plan.invite.length; i += INVITE_BATCH) {
    const batch = plan.invite.slice(i, i + INVITE_BATCH);
    const refused = new Map<string, string>();
    try {
      await slack.call("conversations.invite", { channel: channelId, users: batch.join(","), force: "true" });
    } catch (err) {
      if (!(err instanceof SlackError) || isFatal(err)) throw err;
      // With force, Slack invites the rest and names each it refused.
      const errors = Array.isArray(err.body?.errors) ? (err.body.errors as { user?: string; error?: string }[]) : null;
      if (errors?.some((e) => e.user)) {
        for (const e of errors) if (e.user) refused.set(e.user, e.error ?? err.error);
      } else {
        for (const id of batch) refused.set(id, err.error);
      }
    }
    const invited = batch.filter((id) => !refused.has(id) || refused.get(id) === "already_in_channel");
    const newlyInvited = batch.filter((id) => !refused.has(id));
    if (newlyInvited.length > 0) {
      await db
        .insert(slackChannelMembers)
        .values(newlyInvited.map((id) => ({ slackChannelId: channelId, slackUserId: id, email: emailOf(id) })))
        .onConflictDoNothing();
    }
    for (const id of newlyInvited) log.note({ channelName: channel.name, action: "invited", email: emailOf(id) });
    for (const [id, error] of refused) {
      if (!invited.includes(id)) log.note({ channelName: channel.name, action: "failed", email: emailOf(id), detail: `Invite: ${error}` });
    }
  }

  for (const id of plan.remove) {
    try {
      await slack.call("conversations.kick", { channel: channelId, user: id });
      log.note({ channelName: channel.name, action: "removed", email: emailOf(id) });
    } catch (err) {
      if (!(err instanceof SlackError) || isFatal(err)) throw err;
      if (err.error !== "not_in_channel") {
        log.note({ channelName: channel.name, action: "failed", email: emailOf(id), detail: `Remove: ${err.error}` });
        continue;
      }
    }
    await db
      .delete(slackChannelMembers)
      .where(and(eq(slackChannelMembers.slackChannelId, channelId), eq(slackChannelMembers.slackUserId, id)));
  }
}

/* ------------------------------------------------------------------ */
/* The sync                                                            */
/* ------------------------------------------------------------------ */

export type SlackSyncResult =
  | {
      ok: true;
      runId: string;
      status: "succeeded" | "skipped";
      dryRun: boolean;
      unfinished: boolean;
    } & Tally
  | { ok: false; runId: string | null; error: SlackSyncError; detail?: string };

/**
 * One run, logged. `actorId` is whoever pressed the button, or null for the
 * schedule; `deadline` is when it must stop by, as `Date.now()` counts.
 */
export async function syncSlackChannels(
  trigger: SlackSyncTrigger,
  actorId: string | null,
  deadline: number,
): Promise<SlackSyncResult> {
  const dryRun = !(await getSlackSyncLive());
  const runId = await startRun(trigger, actorId, dryRun);
  if (!runId) return { ok: false, runId: null, error: "already_running" };

  const log = new RunLog(runId);
  try {
    const token = await slackToken();
    if (!token) {
      await finishRun(runId, "failed", { error: LOGGED.not_configured });
      return { ok: false, runId, error: "not_configured" };
    }

    const bootcamp = await activeBootcamp();
    if (!bootcamp) {
      await finishRun(runId, "skipped", { error: "No bootcamp is active in the Scheduler." });
      return { ok: true, runId, status: "skipped", dryRun, unfinished: false, ...log.tally };
    }
    await db.update(slackSyncRuns).set({ bootcampId: bootcamp.id }).where(eq(slackSyncRuns.id, runId));

    const slack = slackClient(token, deadline);
    let unfinished = false;
    try {
      // Fails fast, and plainly, on a token Slack no longer takes.
      await slack.call("auth.test", {});

      const channels = cohortChannels(bootcamp.startDate, bootcamp.intDays !== null);
      const [cohort, contacts] = await Promise.all([currentCohortEmails(), allChannelContacts()]);
      const audiences = new Map(channels.map((ch) => [ch.name, channelAudience(ch, cohort, contacts)]));
      const everyone = [...new Set([...audiences.values()].flatMap((a) => [...a]))].sort();
      const slackIds = await resolveSlackUsers(slack, everyone);

      const missing = everyone.filter((email) => !slackIds.get(email));
      for (const email of missing) log.note({ channelName: "", action: "not_in_slack", email });
      await log.flush();

      const channelIds = await ensureChannels(slack, channels, dryRun, log);
      await log.flush();

      for (const channel of channels) {
        if (!channelIds.has(channel.name)) continue;
        const wanted = new Map<string, string>();
        for (const email of audiences.get(channel.name)!) {
          const id = slackIds.get(email);
          if (id) wanted.set(id, email);
        }
        await syncChannel(slack, channel, channelIds.get(channel.name)!, wanted, dryRun, log);
        await log.flush();
      }
    } catch (err) {
      if (err instanceof SlackOutOfTime) unfinished = true;
      else if (err instanceof SlackError) {
        await log.flush();
        await finishRun(runId, "failed", { ...log.tally, error: `${LOGGED.slack_error} ${err.message}` });
        return { ok: false, runId, error: "slack_error", detail: err.message };
      } else throw err;
    }

    await log.flush();
    await finishRun(runId, "succeeded", { ...log.tally, unfinished });
    return { ok: true, runId, status: "succeeded", dryRun, unfinished, ...log.tally };
  } catch (err) {
    // Anything else — the database, most likely — still ends the run.
    await finishRun(runId, "failed", {
      ...log.tally,
      error: err instanceof Error ? err.message.slice(0, 500) : "The sync failed.",
    }).catch(() => {});
    throw err;
  }
}

/* ------------------------------------------------------------------ */
/* Reading it back                                                     */
/* ------------------------------------------------------------------ */

/** The active bootcamp's channels, with each one's Slack id once the sync has found or made it; null with none active. */
export async function activeCohortChannels(): Promise<{
  bootcampId: string;
  startDate: string;
  channels: { kind: CohortChannelKind; name: string; slackChannelId: string | null; created: boolean }[];
} | null> {
  const bootcamp = await activeBootcamp();
  if (!bootcamp) return null;
  const channels = cohortChannels(bootcamp.startDate, bootcamp.intDays !== null);
  const stored = new Map(
    (
      await db
        .select()
        .from(slackChannels)
        .where(inArray(slackChannels.name, channels.map((c) => c.name)))
    ).map((r) => [r.name, r]),
  );
  return {
    bootcampId: bootcamp.id,
    startDate: bootcamp.startDate,
    channels: channels.map((c) => ({
      kind: c.kind,
      name: c.name,
      slackChannelId: stored.get(c.name)?.slackChannelId ?? null,
      created: stored.get(c.name)?.created ?? false,
    })),
  };
}

export type SlackSyncRunSummary = {
  id: string;
  trigger: SlackSyncTrigger;
  triggeredBy: string | null;
  status: SlackSyncStatus;
  dryRun: boolean;
  startedAt: Date;
  finishedAt: Date | null;
  invited: number;
  removed: number;
  notInSlack: number;
  failures: number;
  unfinished: boolean;
  error: string | null;
};

const RUN_SORT_COLUMNS = {
  startedAt: slackSyncRuns.startedAt,
  triggeredBy: sql`lower(case when ${slackSyncRuns.trigger} = 'schedule' then 'Schedule' else coalesce(nullif(${users.name}, ''), ${users.email}) end)`,
  status: slackSyncRuns.status,
} as const;

const runColumns = {
  id: slackSyncRuns.id,
  trigger: slackSyncRuns.trigger,
  triggeredByName: users.name,
  triggeredByEmail: users.email,
  status: slackSyncRuns.status,
  dryRun: slackSyncRuns.dryRun,
  startedAt: slackSyncRuns.startedAt,
  finishedAt: slackSyncRuns.finishedAt,
  invited: slackSyncRuns.invited,
  removed: slackSyncRuns.removed,
  notInSlack: slackSyncRuns.notInSlack,
  failures: slackSyncRuns.failures,
  unfinished: slackSyncRuns.unfinished,
  error: slackSyncRuns.error,
};

type RunRow = { triggeredByName: string | null; triggeredByEmail: string | null } & Omit<SlackSyncRunSummary, "triggeredBy">;

function summarize({ triggeredByName, triggeredByEmail, ...rest }: RunRow, staleBefore: number): SlackSyncRunSummary {
  return {
    ...rest,
    triggeredBy: triggeredByName ?? triggeredByEmail,
    // The next run closes it for good; until then, say what happened.
    ...(rest.status === "running" && rest.startedAt.getTime() < staleBefore
      ? { status: "failed" as const, error: "Did not finish — the server stopped mid-sync." }
      : {}),
  };
}

/** One page of the run log, newest first unless asked otherwise. The search matches who started it, how, the status and the error. */
export async function listSlackSyncRuns(query: ListQuery<SlackSyncSort>): Promise<Page<SlackSyncRunSummary>> {
  const { limit, offset } = pageWindow(query.page);
  const rows = await db
    .select(runColumns)
    .from(slackSyncRuns)
    .leftJoin(users, eq(users.id, slackSyncRuns.triggeredBy))
    .where(
      searchAny(query.q, [
        users.name,
        users.email,
        slackSyncRuns.trigger,
        slackSyncRuns.status,
        slackSyncRuns.error,
      ]),
    )
    .orderBy(...orderFor(RUN_SORT_COLUMNS[query.sort], query.dir, desc(slackSyncRuns.startedAt), slackSyncRuns.id))
    .limit(limit)
    .offset(offset);
  const staleBefore = Date.now() - STALE_MS;
  return toPage(rows.map((r) => summarize(r, staleBefore)), query.page);
}

/** One run, or null. */
export async function getSlackSyncRun(id: string): Promise<SlackSyncRunSummary | null> {
  const [row] = await db
    .select(runColumns)
    .from(slackSyncRuns)
    .leftJoin(users, eq(users.id, slackSyncRuns.triggeredBy))
    .where(eq(slackSyncRuns.id, id));
  return row ? summarize(row, Date.now() - STALE_MS) : null;
}

/** Whether a run is under way: one marked running that has not gone stale. */
export async function slackSyncInProgress(): Promise<boolean> {
  const [row] = await db
    .select({ id: slackSyncRuns.id })
    .from(slackSyncRuns)
    .where(
      and(eq(slackSyncRuns.status, "running"), sql`${slackSyncRuns.startedAt} >= ${new Date(Date.now() - STALE_MS)}`),
    )
    .limit(1);
  return Boolean(row);
}

export type SlackSyncChangeRow = {
  id: string;
  channelName: string;
  action: SlackSyncAction;
  email: string;
  fullName: string | null;
  detail: string | null;
  at: Date;
};

const CHANGE_SORT_COLUMNS = {
  at: slackSyncChanges.at,
  channelName: slackSyncChanges.channelName,
  action: slackSyncChanges.action,
  email: slackSyncChanges.email,
} as const;

/** One page of what a run did. The search matches the channel, the action, the email, the name or the detail. */
export async function listSlackSyncChanges(
  runId: string,
  query: ListQuery<SlackSyncChangeSort>,
): Promise<Page<SlackSyncChangeRow>> {
  const { limit, offset } = pageWindow(query.page);
  // A sync replaces `employees` wholesale, so the name is looked up now rather than kept.
  // Qualified by hand: with no join, Drizzle writes a bare `"email"`, which inside
  // the subquery would mean `e.email` and match every row.
  const fullName = sql<string | null>`(select e.full_name from employees e where lower(e.email) = "slack_sync_changes"."email" limit 1)`;
  const rows = await db
    .select({
      id: slackSyncChanges.id,
      channelName: slackSyncChanges.channelName,
      action: slackSyncChanges.action,
      email: slackSyncChanges.email,
      fullName,
      detail: slackSyncChanges.detail,
      at: slackSyncChanges.at,
    })
    .from(slackSyncChanges)
    .where(
      and(
        eq(slackSyncChanges.runId, runId),
        searchAny(query.q, [
          slackSyncChanges.channelName,
          slackSyncChanges.action,
          slackSyncChanges.email,
          slackSyncChanges.detail,
          fullName,
        ]),
      ),
    )
    .orderBy(
      ...orderFor(CHANGE_SORT_COLUMNS[query.sort], query.dir, slackSyncChanges.at, slackSyncChanges.id),
    )
    .limit(limit)
    .offset(offset);
  return toPage(rows, query.page);
}
