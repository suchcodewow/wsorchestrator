"use client";

/**
 * The active bootcamp's Slack channels, whether the sync is live or a dry
 * run, the Sync Slack Now button, and every run's result, each linking to
 * what it did.
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
  Hash,
  Loader2,
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
import type { SlackSyncStatus, SlackSyncTrigger } from "@/db/schema";
import type { SlackSyncSort } from "@/lib/list-specs";
import { riseChild, staggerParent } from "@/lib/motion";
import type { ListQuery, Page } from "@/lib/paging";
import { formatDate, formatWhen } from "../format";

export type SlackRun = {
  id: string;
  trigger: SlackSyncTrigger;
  triggeredBy: string | null;
  status: SlackSyncStatus;
  dryRun: boolean;
  startedAt: string;
  finishedAt: string | null;
  invited: number;
  removed: number;
  notInSlack: number;
  failures: number;
  unfinished: boolean;
  error: string | null;
};

export type ActiveChannels = {
  bootcampId: string;
  startDate: string;
  channels: { kind: string; name: string; slackChannelId: string | null; created: boolean }[];
} | null;

const ERRORS: Record<string, string> = {
  not_configured: "No Slack bot token is configured. Set slack_bot_token on the Harness workspace and redeploy.",
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

/** "12 invited, 2 removed, 3 not in Slack", leaving out the zeros; "No changes" for none. */
export function runCounts(run: Pick<SlackRun, "invited" | "removed" | "notInSlack" | "failures" | "dryRun">): string {
  const parts = [
    run.invited && `${run.invited.toLocaleString()} ${run.dryRun ? "to invite" : "invited"}`,
    run.removed && `${run.removed.toLocaleString()} ${run.dryRun ? "to remove" : "removed"}`,
    run.notInSlack && `${run.notInSlack.toLocaleString()} not in Slack`,
    run.failures && plural(run.failures, "failure"),
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : "No changes";
}

export function SlackSyncView({
  configured,
  live,
  active,
  query,
  page,
  running: syncing,
}: {
  configured: boolean;
  live: boolean;
  active: ActiveChannels;
  query: ListQuery<SlackSyncSort>;
  page: Page<SlackRun>;
  /** Whether a sync is under way now, whichever page this is. */
  running: boolean;
}) {
  const runs = page.rows;
  const sortProps = { sort: query.sort, dir: query.dir };
  const router = useRouter();
  const rowLink = useRowLink();
  const [busy, setBusy] = useState<"sync" | "mode" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function syncNow() {
    setBusy("sync");
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/cohorts/slack/sync", { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) setError(message(body, res.status));
      else if (body.status === "skipped") setNotice("No bootcamp is active in the Scheduler, so there was nothing to sync.");
      else setNotice(`${body.dryRun ? "Dry run: " : ""}${runCounts(body)}.${body.unfinished ? " Slack's rate limit stopped it part-way; the next run carries on." : ""}`);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(null);
      // A failed run is logged too.
      router.refresh();
    }
  }

  async function setLive(next: boolean) {
    if (next && !window.confirm("Go live? The next sync will create channels, invite people and remove those it invited who no longer belong.")) {
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

  const running = busy === "sync" || syncing;

  return (
    <motion.div variants={staggerParent(0.05)} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={riseChild} className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-xl font-medium tracking-tight">Slack channels</h2>
          {active && (
            <p className="text-sm text-muted-foreground">
              For the bootcamp starting {formatDate(active.startDate)}
            </p>
          )}
        </div>
        <Button variant="brand" disabled={running || !configured} onClick={syncNow}>
          {running ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          {running ? "Syncing…" : "Sync Slack Now"}
        </Button>
      </motion.div>

      {!configured && (
        <motion.p variants={riseChild} className="flex items-center gap-1.5 text-sm text-destructive">
          <AlertTriangle className="size-3.5 shrink-0" />
          No Slack bot token is configured. Set <code>slack_bot_token</code> on the Harness workspace, then redeploy.
        </motion.p>
      )}

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
        <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
          <div className="space-y-0.5">
            <p className="flex items-center gap-2 text-sm font-medium">
              Mode
              {live ? <Badge>Live</Badge> : <Badge variant="secondary">Dry run</Badge>}
            </p>
            <p className="text-sm text-muted-foreground">
              {live
                ? "Each sync creates the channels, invites the cohort and its contacts, and removes anyone it invited who no longer belongs."
                : "Each sync reads Slack and logs what it would do, without changing anything."}
            </p>
          </div>
          <Button variant="outline" disabled={busy === "mode"} onClick={() => setLive(!live)}>
            {busy === "mode" && <Loader2 className="animate-spin" />}
            {live ? "Switch to dry run" : "Go live"}
          </Button>
        </div>
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
                  <td colSpan={4} className="px-5 py-8 text-center text-muted-foreground">
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
