"use client";

/**
 * The Slack app's install, the active bootcamp's Slack channels, whether the
 * sync is live or a dry run, the Sync Slack Now button, and every run's
 * result, each linking to what it did.
 */

import { useEffect, useState } from "react";
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
  Plug,
  RefreshCw,
  Unplug,
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
  not_configured: "Slack is not connected. Add the app to Slack above.",
  already_running: "A sync is already running — its result will appear below.",
  slack_error: "Slack refused the sync.",
  not_found: "Slack was already disconnected.",
  forbidden: "Your own role changed — reload the page.",
};

/** What `oauth/callback` said about an Add to Slack, as `?slack=`. */
const INSTALL_ERRORS: Record<string, string> = {
  cancelled: "Add to Slack was cancelled; nothing changed.",
  bad_state: "That Add to Slack expired or was started in another browser. Start it again.",
  slack_error: "Slack refused the install.",
};

function installMessage({ result, detail }: { result: string; detail: string | null }) {
  if (result === "installed") return { notice: "Slack is connected. The next sync uses the app's bot." };
  const text = INSTALL_ERRORS[result] ?? "Add to Slack did not finish.";
  return { error: detail ? `${text} Slack answered ${detail}.` : text };
}

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
  connection,
  installResult,
  live,
  active,
  query,
  page,
  running: syncing,
}: {
  configured: boolean;
  connection: SlackConnection;
  /** How an Add to Slack that just returned here went. */
  installResult: { result: string; detail: string | null } | null;
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
  const [busy, setBusy] = useState<"sync" | "mode" | "disconnect" | null>(null);
  const installed = installResult ? installMessage(installResult) : null;
  const [error, setError] = useState<string | null>(installed?.error ?? null);
  const [notice, setNotice] = useState<string | null>(installed?.notice ?? null);

  // Said once: a reload should not say it again.
  useEffect(() => {
    if (!installResult) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("slack");
    url.searchParams.delete("detail");
    window.history.replaceState(null, "", url);
  }, [installResult]);

  async function disconnect() {
    if (!window.confirm("Disconnect Slack? Syncs stop until the app is added again. The app stays installed in Slack itself.")) {
      return;
    }
    setBusy("disconnect");
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/cohorts/slack/installation", { method: "DELETE" });
      const body = await res.json().catch(() => null);
      if (!res.ok) setError(message(body, res.status));
      else router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(null);
    }
  }

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

      {!configured && !connection.appConfigured && (
        <motion.p variants={riseChild} className="flex items-center gap-1.5 text-sm text-destructive">
          <AlertTriangle className="size-3.5 shrink-0" />
          No Slack app is configured. Set <code>slack_app_client_id</code> and <code>slack_app_client_secret</code> on
          the Harness workspace, then redeploy.
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
        <ConnectionRow connection={connection} disconnecting={busy === "disconnect"} onDisconnect={disconnect} />
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

/** Which bot the sync acts as: the installed app, the deployment's token, or none yet. */
function ConnectionRow({
  connection: { appConfigured, envToken, installation },
  disconnecting,
  onDisconnect,
}: {
  connection: SlackConnection;
  disconnecting: boolean;
  onDisconnect: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
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
              : "Add the app so the sync can read and change the cohort channels."}
        </p>
        {installation && !installation.readable && (
          <p className="text-sm text-destructive">
            This deployment cannot open the saved token, which another deployment sealed. Add the app again.
          </p>
        )}
        {installation?.readable && installation.missingScopes.length > 0 && (
          <p className="flex items-center gap-1.5 text-sm text-amber-700 dark:text-amber-400">
            <AlertTriangle className="size-3.5 shrink-0" />
            Missing {installation.missingScopes.join(", ")}. Add it again to grant them.
          </p>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {appConfigured && (
          <Button asChild variant={installation?.readable ? "outline" : "brand"}>
            {/* A plain link: the install leaves for slack.com and comes back through the callback. */}
            <a href="/api/cohorts/slack/install">
              <Plug />
              {installation ? "Add again" : "Add to Slack"}
            </a>
          </Button>
        )}
        {installation && (
          <Button variant="outline" disabled={disconnecting} onClick={onDisconnect}>
            {disconnecting ? <Loader2 className="animate-spin" /> : <Unplug />}
            Disconnect
          </Button>
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
