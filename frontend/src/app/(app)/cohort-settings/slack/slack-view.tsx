"use client";

/**
 * The Slack app's install, the active bootcamp's Slack channels, the intake
 * form's reminders, whether the sync is live or a dry run, the Preview and
 * Sync Slack Now buttons, and every run's result, each linking to what it
 * did and sent, and to whom.
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ExternalLink,
  Eye,
  Hash,
  Loader2,
  MessageSquare,
  MinusCircle,
  RefreshCw,
  User,
  XCircle,
} from "lucide-react";
import {
  HEADER_ROW,
  LINK_ROW,
  Pager,
  PlainHeader,
  SortHeader,
  TableSearch,
  useRowLink,
} from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { INTAKE_FORM_IDS, type SlackSyncScope, type SlackSyncStatus, type SlackSyncTrigger } from "@/db/schema";
import type { IntakeCounts } from "@/lib/logistics/intake-reminders";
import { INTAKE_FORM_LABELS } from "@/lib/logistics/intake-values";
import type { SlackSyncSort } from "@/lib/list-specs";
import { riseChild, staggerParent } from "@/lib/motion";
import type { ListQuery, Page } from "@/lib/paging";
import { cn } from "@/lib/utils";
import { formatDate, formatWhen } from "../format";

export type SlackRun = {
  id: string;
  trigger: SlackSyncTrigger;
  scope: SlackSyncScope;
  triggeredBy: string | null;
  status: SlackSyncStatus;
  dryRun: boolean;
  startedAt: string;
  finishedAt: string | null;
  invited: number;
  removed: number;
  messaged: number;
  notInSlack: number;
  failures: number;
  unfinished: boolean;
  error: string | null;
  notes: string[];
};

/** What a run set out to do, as the log names it. */
export const SCOPE_LABELS: Record<SlackSyncScope, string> = {
  all: "Channels and messages",
  channels: "Channels",
  reminders: "Messages",
};

/** The intake form's daily reminder, and how each form stands with the current cohort. */
export type ReminderStatus = {
  on: boolean;
  sentToday: boolean;
  /** By form: how many in the cohort are asked it, how many have answered, and how many questions it has. */
  counts: IntakeCounts;
};

export type ActiveChannels = {
  bootcampId: string;
  startDate: string;
  channels: { kind: string; name: string; slackChannelId: string | null; created: boolean }[];
} | null;

export type SlackConnection = {
  /** Whether this deployment has the app's Client ID and secret, and so can offer Add to Slack. */
  appConfigured: boolean;
  /** Whether the deployment also sets SLACK_BOT_TOKEN, used while nothing is installed. */
  envToken: boolean;
  installation: {
    teamId: string;
    teamName: string | null;
    scopes: string[];
    missingScopes: string[];
    readable: boolean;
    installedBy: string | null;
    installedAt: string;
  } | null;
};

const ERRORS: Record<string, string> = {
  not_configured: "Slack is not connected. A platform administrator adds the app under Admin Settings → External Connectors.",
  already_running: "A sync is already running — its result will appear below.",
  slack_error: "Slack refused the sync.",
  forbidden: "Your own role changed — reload the page.",
};

function message(body: { error?: string; detail?: string } | null, status: number) {
  const text = ERRORS[body?.error ?? ""] ?? `Something went wrong (${status}).`;
  return body?.detail ? `${text} ${body.detail}` : text;
}

function plural(n: number, one: string, many = `${one}s`) {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

/** "12 invited, 2 removed, 5 messaged, 3 not in Slack", leaving out the zeros; "No changes" for none. */
export function runCounts(
  run: Pick<SlackRun, "invited" | "removed" | "messaged" | "notInSlack" | "failures" | "dryRun">,
): string {
  const parts = [
    run.invited && `${run.invited.toLocaleString()} ${run.dryRun ? "to invite" : "invited"}`,
    run.removed && `${run.removed.toLocaleString()} ${run.dryRun ? "to remove" : "removed"}`,
    run.messaged && `${run.messaged.toLocaleString()} ${run.dryRun ? "to message" : "messaged"}`,
    run.notInSlack && `${run.notInSlack.toLocaleString()} not in Slack`,
    run.failures && plural(run.failures, "failure"),
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : "No changes";
}

export function SlackSyncView({
  configured,
  connection,
  live,
  active,
  reminders,
  query,
  page,
  running: syncing,
}: {
  configured: boolean;
  connection: SlackConnection;
  live: boolean;
  active: ActiveChannels;
  reminders: ReminderStatus;
  query: ListQuery<SlackSyncSort>;
  page: Page<SlackRun>;
  /** Whether a sync is under way now, whichever page this is. */
  running: boolean;
}) {
  const runs = page.rows;
  const sortProps = { sort: query.sort, dir: query.dir };
  const router = useRouter();
  const rowLink = useRowLink();
  const [busy, setBusy] = useState<"sync" | "preview" | "mode" | "reminders" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /**
   * Runs the sync, or with `preview` a dry run of it, then opens the run to
   * show everything it did or would do, and sent or would send, and to whom.
   */
  async function sync(preview: boolean) {
    if (
      !preview &&
      live &&
      !window.confirm(
        "Sync Slack now? It changes the cohort channels and sends the intake form reminders that are due. Preview shows what it would do without doing it.",
      )
    ) {
      return;
    }
    setBusy(preview ? "preview" : "sync");
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/cohorts/slack/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(preview ? { preview: true } : {}),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(message(body, res.status));
        // A failed run is logged too.
        router.refresh();
      } else {
        router.push(`/cohort-settings/slack/${body.runId}`);
      }
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(null);
    }
  }

  async function setLive(next: boolean) {
    if (next === live) return;
    if (
      next &&
      !window.confirm(
        "Go live? From the next sync, it creates channels, invites people, removes those it invited who no longer belong, and sends the intake form reminders that are due.",
      )
    ) {
      return;
    }
    setBusy("mode");
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/cohorts/slack/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ live: next }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) setError(message(body, res.status));
      else router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(null);
    }
  }

  async function setReminders(next: boolean) {
    if (
      next &&
      !window.confirm(
        live
          ? "Turn the daily reminder on? From the next sync, everyone in the current cohort who has not answered their form gets a Slack message once a day."
          : "Turn the daily reminder on? The sync is in dry run, so reminders are logged, not sent, until it goes live.",
      )
    ) {
      return;
    }
    setBusy("reminders");
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/cohorts/slack/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reminders: next }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) setError(message(body, res.status));
      else router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(null);
    }
  }

  const running = busy === "sync" || busy === "preview" || syncing;
  const syncLabel = busy === "sync" || (syncing && busy === null);

  return (
    <motion.div variants={staggerParent(0.05)} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={riseChild} className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-xl font-medium tracking-tight">Slack</h2>
          {active && (
            <p className="text-sm text-muted-foreground">
              For the bootcamp starting {formatDate(active.startDate)}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {/* In dry run every sync is already a preview; live, this is the way to see one first. */}
          {live && (
            <Button
              variant="outline"
              disabled={running}
              title="A dry run: see what a sync would change and send, and to whom, without doing any of it"
              onClick={() => sync(true)}
            >
              {busy === "preview" ? <Loader2 className="animate-spin" /> : <Eye />}
              Preview
            </Button>
          )}
          <Button
            variant="brand"
            // A dry run works without Slack; a live one needs it.
            disabled={running || (live && !configured)}
            title={live ? undefined : "A dry run: logs what it would change and send, and to whom, without doing any of it"}
            onClick={() => sync(false)}
          >
            {syncLabel ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            {syncLabel ? "Syncing…" : "Sync Slack Now"}
          </Button>
        </div>
      </motion.div>

      {error && (
        <motion.p variants={riseChild} role="alert" className="text-sm text-destructive">
          {error}
        </motion.p>
      )}
      {notice && (
        <motion.p variants={riseChild} role="status" className="text-sm text-muted-foreground">
          {notice}
        </motion.p>
      )}

      <motion.div variants={riseChild} className="divide-y overflow-hidden rounded-2xl border bg-card shadow-sm">
        <ConnectionRow connection={connection} />
        <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4 sm:flex-nowrap">
          <div className="min-w-0 space-y-0.5">
            <p className="text-sm font-medium">Mode</p>
            <p className="text-sm text-muted-foreground">
              {live
                ? "Each sync creates the channels, invites the cohort and its contacts, removes anyone it invited who no longer belongs, and sends the reminders that are due."
                : configured
                  ? "Each sync reads Slack and logs the channels it would create, who it would add and remove, and the messages it would send, without changing or sending anything."
                  : "Each sync logs the channels it would create, who it would add, and the messages it would send, without Slack: connect it to check who is already there."}
            </p>
          </div>
          <div role="radiogroup" aria-label="Mode" className="inline-flex shrink-0 items-center rounded-lg border bg-card p-0.5 shadow-xs">
            {([
              [false, "Dry run"],
              [true, "Live"],
            ] as const).map(([value, label]) => (
              <button
                key={label}
                type="button"
                role="radio"
                aria-checked={live === value}
                disabled={busy === "mode"}
                onClick={() => setLive(value)}
                className={cn(
                  "inline-flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-sm outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-wait",
                  live === value
                    ? value
                      ? "bg-brand font-medium text-brand-foreground"
                      : "bg-accent font-medium text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {busy === "mode" && live !== value && <Loader2 className="size-3.5 animate-spin" />}
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4 sm:flex-nowrap">
          <div className="min-w-0 space-y-0.5">
            <p className="flex items-center gap-2 text-sm font-medium">
              <MessageSquare className="size-3.5 text-muted-foreground" />
              Daily reminder
              {reminders.on ? <Badge>On</Badge> : <Badge variant="secondary">Off</Badge>}
            </p>
            <p className="text-sm text-muted-foreground">
              {!reminders.on
                ? "Nobody is reminded to fill in their intake form, on the schedule or by Sync Slack Now."
                : reminders.sentToday
                  ? "Today's have gone out; the next go out tomorrow, to whoever has still not answered their intake form."
                  : "Once a day, and with Sync Slack Now, everyone in the current cohort who has not answered their intake form gets a direct message linking to it."}
            </p>
          </div>
          <Button
            variant="outline"
            className="shrink-0"
            disabled={busy === "reminders"}
            onClick={() => setReminders(!reminders.on)}
          >
            {busy === "reminders" && <Loader2 className="animate-spin" />}
            {reminders.on ? "Turn off" : "Turn on"}
          </Button>
        </div>
        {INTAKE_FORM_IDS.map((id) => {
          const c = reminders.counts[id];
          return (
            <div key={id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
              <span className="text-sm font-medium">{INTAKE_FORM_LABELS[id]}</span>
              <span className="text-sm text-muted-foreground tabular-nums">
                {c.questions === 0
                  ? `No questions yet, so none of the ${c.asked.toLocaleString()} in the stage is reminded`
                  : `${c.answered.toLocaleString()} of ${c.asked.toLocaleString()} answered`}
              </span>
            </div>
          );
        })}
        {active ? (
          active.channels.map((ch) => (
            <div key={ch.name} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
              <span className="flex items-center gap-1.5 font-mono text-sm">
                <Hash className="size-3.5 text-muted-foreground" />
                {ch.name}
              </span>
              {ch.slackChannelId ? (
                <a
                  href={`https://slack.com/app_redirect?channel=${ch.slackChannelId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
                >
                  {ch.created ? "Created by the sync" : "Already existed"}
                  <ExternalLink className="size-3.5" />
                </a>
              ) : (
                <span className="text-sm text-muted-foreground">Not created yet</span>
              )}
            </div>
          ))
        ) : (
          <p className="px-5 py-4 text-sm text-muted-foreground">
            No bootcamp is active in the Scheduler, so each sync skips itself.
          </p>
        )}
      </motion.div>

      <motion.div variants={riseChild}>
        <TableSearch value={query.q} placeholder="Search by who, status or error" label="Search the sync log" />
      </motion.div>

      <motion.div variants={riseChild} className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-180 text-sm">
            <thead>
              <tr className={HEADER_ROW}>
                <SortHeader column="startedAt" {...sortProps}>
                  Started
                </SortHeader>
                <SortHeader column="triggeredBy" {...sortProps}>
                  Triggered by
                </SortHeader>
                <PlainHeader>Covers</PlainHeader>
                <SortHeader column="status" {...sortProps}>
                  Result
                </SortHeader>
                <PlainHeader className="w-24" />
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr
                  key={run.id}
                  className={`${LINK_ROW} align-top`}
                  onClick={rowLink(`/cohort-settings/slack/${run.id}`)}
                >
                  <td className="whitespace-nowrap px-5 py-2.5 tabular-nums">
                    <Link href={`/cohort-settings/slack/${run.id}`} className="group-hover:underline">
                      {formatWhen(run.startedAt)}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-5 py-2.5 text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      {run.trigger === "schedule" ? (
                        <>
                          <CalendarClock className="size-3.5" />
                          Schedule
                        </>
                      ) : (
                        <>
                          <User className="size-3.5" />
                          {run.triggeredBy ?? "Someone since removed"}
                        </>
                      )}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-5 py-2.5 text-muted-foreground">{SCOPE_LABELS[run.scope]}</td>
                  <td className="px-5 py-2.5">
                    <RunResult run={run} />
                  </td>
                  <td className="whitespace-nowrap px-5 py-2.5 text-right">
                    {run.dryRun && <Badge variant="secondary">Dry run</Badge>}
                  </td>
                </tr>
              ))}
              {runs.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-muted-foreground">
                    {query.q ? "No syncs match." : "No syncs yet."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="border-t empty:hidden">
          <Pager page={page} noun="syncs" />
        </div>
      </motion.div>
    </motion.div>
  );
}

/** Which bot the sync acts as: the installed app, the deployment's token, or none yet. Connected under Admin Settings → External Connectors. */
function ConnectionRow({ connection: { envToken, installation } }: { connection: SlackConnection }) {
  return (
    <div className="px-5 py-4">
      <div className="space-y-0.5">
        <p className="flex items-center gap-2 text-sm font-medium">
          Slack app
          {installation?.readable ? (
            <Badge>Connected</Badge>
          ) : installation ? (
            <Badge variant="destructive">Add again</Badge>
          ) : (
            <Badge variant="secondary">{envToken ? "Deployment token" : "Not connected"}</Badge>
          )}
        </p>
        <p className="text-sm text-muted-foreground">
          {installation
            ? `${installation.teamName ?? installation.teamId}, added by ${installation.installedBy ?? "someone since removed"} on ${formatWhen(installation.installedAt)}`
            : envToken
              ? "The sync uses the deployment's SLACK_BOT_TOKEN until the app is added."
              : "A platform administrator adds the app under Admin Settings → External Connectors."}
        </p>
        {installation && !installation.readable && (
          <p className="text-sm text-destructive">
            This deployment cannot open the saved token, which another deployment sealed. A platform administrator needs to add the app again.
          </p>
        )}
        {installation?.readable && installation.missingScopes.length > 0 && (
          <p className="flex items-center gap-1.5 text-sm text-amber-700 dark:text-amber-400">
            <AlertTriangle className="size-3.5 shrink-0" />
            Missing {installation.missingScopes.join(", ")}. Add the app again to grant them.
          </p>
        )}
      </div>
    </div>
  );
}

export function RunResult({ run }: { run: SlackRun }) {
  if (run.status === "running") {
    return (
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        Running
      </span>
    );
  }
  if (run.status === "skipped") {
    return (
      <span className="flex items-center gap-1.5 text-muted-foreground">
        <MinusCircle className="size-3.5 shrink-0" />
        {run.error ?? "Skipped"}
      </span>
    );
  }
  if (run.status === "succeeded") {
    return (
      <span className="flex items-center gap-1.5">
        {run.failures > 0 ? (
          <AlertTriangle className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
        ) : (
          <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
        )}
        {runCounts(run)}
        {run.unfinished && <span className="text-muted-foreground">, unfinished</span>}
      </span>
    );
  }
  return (
    <span className="flex items-start gap-1.5 text-destructive">
      <XCircle className="mt-0.5 size-3.5 shrink-0" />
      <span className="wrap-break-word">{run.error ?? "Failed"}</span>
    </span>
  );
}
