/**
 * The Diagnostic's daily Slack reminder. Every Participant who has not
 * finished all the subjects open to them (those with enough approved
 * questions) is sent a direct message with where they stand and a link to
 * their tests. Nobody is reminded while no subject is open.
 *
 * It runs on the `diagnostic-reminders` timed job, once a day, and with
 * Remind Now on Diagnostic Settings → Slack. Until an Assessments
 * Administrator puts it live there, every run is a dry run: it logs whom it
 * would message, and what, and sends nothing. The schedule sends at most once
 * per America/New_York day, so a retried tick does not message anyone twice;
 * Remind Now is someone asking for it, and sends whenever it is pressed.
 *
 * Slack is the same bot the cohort sync uses (`lib/slack.ts`), installed on
 * Cohort Settings → Slack, and people are found in it the same way
 * (`resolveSlackUsers`): by their address on the employee list. Someone not on
 * it, such as a test account, is logged as not in Slack.
 */

import "server-only";

import { and, asc, desc, eq, lt, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  IRIS_SETTINGS_KEYS,
  employees,
  irisAttempts,
  irisReminderMessages,
  irisReminderRuns,
  irisSettings,
  users,
  type IrisReminderOutcome,
  type IrisReminderRun,
  type IrisReminderTrigger,
} from "@/db/schema";
import { isFatal, resolveSlackUsers } from "@/lib/cohorts/slack-sync";
import { participantEmails } from "@/lib/iris/participants";
import { reminderText, type ReminderStatus } from "@/lib/iris/reminder-values";
import { approvedCounts, isLive } from "@/lib/iris/reviews";
import { OPEN_SUBJECT_KEYS, isSubjectKey, type SubjectKey } from "@/lib/iris/subjects";
import type { IrisReminderMessageSort, IrisReminderRunSort } from "@/lib/list-specs";
import { pageWindow, toPage, type ListQuery, type Page } from "@/lib/paging";
import { orderFor, searchAny } from "@/lib/paging-sql";
import { SlackError, SlackOutOfTime, slackClient, slackToken } from "@/lib/slack";
import { SLACK_DM_SCOPES, getSlackInstallation } from "@/lib/slack-app";

/** A run still marked running after this was cut off. */
const STALE_MS = 10 * 60_000;
/** More Participants than this are not reminded in one run; the rest are, the next day. */
const MAX_DUE = 2_000;

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

async function readSetting(key: string): Promise<string | null> {
  const [row] = await db.select({ value: irisSettings.value }).from(irisSettings).where(eq(irisSettings.key, key));
  return row?.value ?? null;
}

/** Whether reminders are sent; false, a dry run, until an administrator puts them live. */
export async function getRemindersLive(): Promise<boolean> {
  return (await readSetting(IRIS_SETTINGS_KEYS.remindersLive)) === "true";
}

export async function setRemindersLive(actorId: string, live: boolean): Promise<void> {
  const value = live ? "true" : "false";
  await db
    .insert(irisSettings)
    .values({ key: IRIS_SETTINGS_KEYS.remindersLive, value, updatedBy: actorId })
    .onConflictDoUpdate({ target: irisSettings.key, set: { value, updatedBy: actorId, updatedAt: new Date() } });
}

/** Today in America/New_York, `YYYY-MM-DD`: the day the timed job's schedule is set in. */
function easternDay(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now);
}

/** Whether the schedule has sent today's reminders. */
export async function remindersSentToday(): Promise<boolean> {
  return (await readSetting(IRIS_SETTINGS_KEYS.remindersSentOn)) === easternDay();
}

/** Marks today's as sent, or false if they already were. One statement, so two runs at once cannot both win. */
async function claimToday(): Promise<boolean> {
  const today = easternDay();
  const claimed = await db
    .insert(irisSettings)
    .values({ key: IRIS_SETTINGS_KEYS.remindersSentOn, value: today })
    .onConflictDoUpdate({
      target: irisSettings.key,
      set: { value: today, updatedAt: new Date() },
      setWhere: ne(irisSettings.value, today),
    })
    .returning({ key: irisSettings.key });
  return claimed.length > 0;
}

/* ------------------------------------------------------------------ */
/* Who is due                                                          */
/* ------------------------------------------------------------------ */

export type DueParticipant = { email: string; fullName: string; status: ReminderStatus };

/** The subjects a Participant is asked to take: those open, with enough approved questions on form A. */
export async function assignedSubjects(): Promise<SubjectKey[]> {
  const approved = await approvedCounts("A");
  return OPEN_SUBJECT_KEYS.filter((k) => isLive(approved[k]));
}

/** Every Participant with at least one assigned subject not finished, and where they stand on each. */
export async function dueParticipants(): Promise<{ assigned: SubjectKey[]; due: DueParticipant[] }> {
  const assigned = await assignedSubjects();
  if (assigned.length === 0) return { assigned, due: [] };
  const inAssigned = sql.join(
    assigned.map((k) => sql`${k}`),
    sql`, `,
  );
  const { rows } = await db.execute<{ email: string; fullName: string; done: string[]; started: string[] }>(sql`
    select p.email, coalesce(nullif(u.name, ''), emp.full_name, '') as "fullName",
           coalesce(array_agg(a.subject) filter (where a.finished_at is not null), '{}') as done,
           coalesce(array_agg(a.subject) filter (where a.id is not null and a.finished_at is null), '{}') as started
      from (${await participantEmails()}) p
      left join ${users} u on lower(u.email) = p.email
      left join lateral (
        select e.full_name from ${employees} e where e.email = p.email order by e.active desc limit 1
      ) emp on true
      left join ${irisAttempts} a
        on a.user_id = u.id and a.mode = 'live' and a.form = 'A' and a.subject in (${inAssigned})
     group by p.email, u.name, emp.full_name
     order by p.email
     limit ${MAX_DUE}`);

  const due: DueParticipant[] = [];
  for (const r of rows) {
    const done = new Set(r.done.filter(isSubjectKey));
    const started = new Set(r.started.filter(isSubjectKey));
    if (assigned.every((k) => done.has(k))) continue;
    due.push({
      email: r.email,
      fullName: r.fullName,
      status: {
        done: assigned.filter((k) => done.has(k)),
        started: assigned.filter((k) => !done.has(k) && started.has(k)),
        notStarted: assigned.filter((k) => !done.has(k) && !started.has(k)),
      },
    });
  }
  return { assigned, due };
}

/* ------------------------------------------------------------------ */
/* A run                                                               */
/* ------------------------------------------------------------------ */

export type ReminderError = "already_running" | "not_configured" | "missing_scopes" | "slack_error";

export const REMINDER_STATUS_FOR: Record<ReminderError, number> = {
  already_running: 409,
  not_configured: 409,
  missing_scopes: 409,
  slack_error: 502,
};

export type ReminderResult =
  | {
      ok: true;
      runId: string;
      status: "succeeded" | "skipped";
      dryRun: boolean;
      due: number;
      messaged: number;
      notInSlack: number;
      failed: number;
      note: string | null;
    }
  | { ok: false; runId: string | null; error: ReminderError; detail?: string };

export type ReminderOptions = {
  /** A dry run whether or not reminders are live, to see what would be sent. */
  preview?: boolean;
  /** The app's own origin, for the link in each message. */
  appUrl: string;
};

async function closeStaleRuns(): Promise<void> {
  await db
    .update(irisReminderRuns)
    .set({ status: "failed", finishedAt: new Date(), error: "Cut off before it finished." })
    .where(and(eq(irisReminderRuns.status, "running"), lt(irisReminderRuns.startedAt, new Date(Date.now() - STALE_MS))));
}

type Tally = { due: number; messaged: number; notInSlack: number; failed: number };

async function finish(
  runId: string,
  status: "succeeded" | "skipped" | "failed",
  tally: Tally,
  note: string | null,
  error: string | null = null,
): Promise<void> {
  await db
    .update(irisReminderRuns)
    .set({ status, finishedAt: new Date(), ...tally, note, error })
    .where(eq(irisReminderRuns.id, runId));
}

/**
 * One run, logged. `actorId` is whoever pressed Remind Now, or null for the
 * schedule; `deadline` is when it must stop by, as `Date.now()` counts.
 */
export async function runDiagnosticReminders(
  trigger: IrisReminderTrigger,
  actorId: string | null,
  deadline: number,
  { preview = false, appUrl }: ReminderOptions,
): Promise<ReminderResult> {
  const dryRun = preview || !(await getRemindersLive());
  await closeStaleRuns();
  const [run] = await db
    .insert(irisReminderRuns)
    .values({ trigger, triggeredBy: actorId, dryRun })
    .onConflictDoNothing()
    .returning({ id: irisReminderRuns.id });
  if (!run) return { ok: false, runId: null, error: "already_running" };
  const runId = run.id;
  const tally: Tally = { due: 0, messaged: 0, notInSlack: 0, failed: 0 };
  const notes: string[] = [];

  try {
    const token = await slackToken();
    if (!token && !dryRun) {
      await finish(runId, "failed", tally, null, "Slack is not connected. Add the app on Cohort Settings → Slack.");
      return { ok: false, runId, error: "not_configured" };
    }
    const installation = token ? await getSlackInstallation() : null;
    const missing = installation?.readable ? SLACK_DM_SCOPES.filter((s) => !installation.scopes.includes(s)) : [];
    if (missing.length > 0 && !dryRun) {
      const detail = `The Slack app is missing ${missing.join(", ")}. Add it again on Cohort Settings → Slack to grant them.`;
      await finish(runId, "failed", tally, null, detail);
      return { ok: false, runId, error: "missing_scopes", detail };
    }
    if (!token) notes.push("Slack is not connected, so this dry run takes it that everyone due is in Slack.");

    // The schedule sends once a day; a dry run, or someone pressing Remind Now, is not held to that.
    if (trigger === "schedule" && !dryRun && !(await claimToday())) {
      const note = "Today's reminders have already gone out.";
      await finish(runId, "skipped", tally, note);
      return { ok: true, runId, status: "skipped", dryRun, ...tally, note };
    }

    const { assigned, due } = await dueParticipants();
    tally.due = due.length;
    if (due.length === 0) {
      const note =
        assigned.length === 0
          ? "No subject is open yet, so nobody has a test to be reminded of. Approve questions on the Questions tab."
          : "Every Participant has finished every open subject, so no reminders were due.";
      await finish(runId, "skipped", tally, [...notes, note].join(" "));
      return { ok: true, runId, status: "skipped", dryRun, ...tally, note };
    }

    const slack = token ? slackClient(token, deadline) : null;
    const link = `${appUrl.replace(/\/+$/, "")}/diagnostic/tests`;
    const rows: { email: string; fullName: string; outcome: IrisReminderOutcome; detail: string }[] = [];
    const flush = async () => {
      if (rows.length === 0) return;
      await db.insert(irisReminderMessages).values(rows.splice(0).map((r) => ({ runId, ...r })));
    };
    const record = (email: string, fullName: string, outcome: IrisReminderOutcome, detail: string) => {
      rows.push({ email, fullName, outcome, detail });
      tally[outcome === "messaged" ? "messaged" : outcome === "not_in_slack" ? "notInSlack" : "failed"]++;
    };

    try {
      if (slack) await slack.call("auth.test", {});
      const ids = slack
        ? await resolveSlackUsers(
            slack,
            due.map((p) => p.email),
          )
        : new Map(due.map((p) => [p.email, p.email]));
      for (const person of due) {
        const user = ids.get(person.email);
        if (!user) {
          record(person.email, person.fullName, "not_in_slack", "No Slack account found for this address");
          continue;
        }
        const text = reminderText(person.fullName, person.status, link);
        if (dryRun || !slack) {
          record(person.email, person.fullName, "messaged", text);
          continue;
        }
        try {
          const { channel } = await slack.call<{ channel: { id: string } }>("conversations.open", { users: user });
          await slack.call("chat.postMessage", { channel: channel.id, text, unfurl_links: "false" });
          record(person.email, person.fullName, "messaged", text);
        } catch (err) {
          if (!(err instanceof SlackError) || isFatal(err)) throw err;
          record(person.email, person.fullName, "failed", `Slack answered ${err.error}`);
        }
        if (rows.length >= 100) await flush();
      }
    } catch (err) {
      await flush();
      if (err instanceof SlackOutOfTime) {
        notes.push("Ran out of time waiting on Slack; the rest are reminded on the next run.");
      } else if (err instanceof SlackError) {
        await finish(runId, "failed", tally, notes.join(" ") || null, err.message);
        return { ok: false, runId, error: "slack_error", detail: err.message };
      } else throw err;
    }
    await flush();
    const summary = notes.join(" ") || null;
    await finish(runId, "succeeded", tally, summary);
    return { ok: true, runId, status: "succeeded", dryRun, ...tally, note: summary };
  } catch (err) {
    // Anything else, the database most likely, still ends the run.
    await finish(
      runId,
      "failed",
      tally,
      notes.join(" ") || null,
      err instanceof Error ? err.message.slice(0, 500) : "The run failed.",
    ).catch(() => {});
    throw err;
  }
}

/* ------------------------------------------------------------------ */
/* Reading it back                                                     */
/* ------------------------------------------------------------------ */

export type ReminderRunSummary = IrisReminderRun & { triggeredByName: string | null };

const triggeredByName = sql<
  string | null
>`(select coalesce(nullif(u.name, ''), u.email) from ${users} u where u.id = ${irisReminderRuns.triggeredBy})`;

const RUN_SORT_COLUMNS = {
  startedAt: irisReminderRuns.startedAt,
  status: irisReminderRuns.status,
} as const;

/** One page of runs, newest first by default; the search matches who ran it, its status, note or error. */
export async function listReminderRuns(query: ListQuery<IrisReminderRunSort>): Promise<Page<ReminderRunSummary>> {
  const { limit, offset } = pageWindow(query.page);
  const rows = await db
    .select({ run: irisReminderRuns, triggeredByName })
    .from(irisReminderRuns)
    .where(searchAny(query.q, [triggeredByName, irisReminderRuns.status, irisReminderRuns.note, irisReminderRuns.error]))
    .orderBy(...orderFor(RUN_SORT_COLUMNS[query.sort], query.dir, desc(irisReminderRuns.startedAt), irisReminderRuns.id))
    .limit(limit)
    .offset(offset);
  return toPage(
    rows.map((r) => ({ ...r.run, triggeredByName: r.triggeredByName })),
    query.page,
  );
}

export async function getReminderRun(id: string): Promise<ReminderRunSummary | null> {
  const [row] = await db.select({ run: irisReminderRuns, triggeredByName }).from(irisReminderRuns).where(eq(irisReminderRuns.id, id));
  return row ? { ...row.run, triggeredByName: row.triggeredByName } : null;
}

export async function reminderRunInProgress(): Promise<boolean> {
  await closeStaleRuns();
  const [row] = await db.select({ id: irisReminderRuns.id }).from(irisReminderRuns).where(eq(irisReminderRuns.status, "running")).limit(1);
  return Boolean(row);
}

export type ReminderMessage = typeof irisReminderMessages.$inferSelect;

const MESSAGE_SORT_COLUMNS = {
  at: irisReminderMessages.at,
  person: sql`lower(coalesce(nullif(${irisReminderMessages.fullName}, ''), ${irisReminderMessages.email}))`,
  outcome: irisReminderMessages.outcome,
} as const;

/** One page of whom a run messaged, would have, or could not, in the order it went; the search matches the name, email or detail. */
export async function listReminderMessages(runId: string, query: ListQuery<IrisReminderMessageSort>): Promise<Page<ReminderMessage>> {
  const { limit, offset } = pageWindow(query.page);
  const rows = await db
    .select()
    .from(irisReminderMessages)
    .where(
      and(
        eq(irisReminderMessages.runId, runId),
        searchAny(query.q, [irisReminderMessages.fullName, irisReminderMessages.email, irisReminderMessages.detail]),
      ),
    )
    .orderBy(...orderFor(MESSAGE_SORT_COLUMNS[query.sort], query.dir, asc(irisReminderMessages.at), irisReminderMessages.id))
    .limit(limit)
    .offset(offset);
  return toPage(rows, query.page);
}
