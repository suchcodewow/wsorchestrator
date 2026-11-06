"use client";

/**
 * The Diagnostic's daily Slack reminder: whether Slack is connected, live or
 * a dry run, its schedule, how many Participants are due, the Preview and
 * Remind Now buttons, and every run's result, each linking to whom it
 * messaged and what it said.
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { CalendarClock, Eye, Loader2, Send, User } from "lucide-react";
import { HEADER_ROW, LINK_ROW, Pager, PlainHeader, SortHeader, TableSearch, useRowLink } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { confirmDialog } from "@/components/ui/confirm";
import type { IrisReminderStatus, IrisReminderTrigger } from "@/db/schema";
import type { IrisReminderRunSort } from "@/lib/list-specs";
import { riseChild, staggerParent } from "@/lib/motion";
import type { ListQuery, Page } from "@/lib/paging";

export type ReminderRun = {
  id: string;
  trigger: IrisReminderTrigger;
  triggeredByName: string | null;
  dryRun: boolean;
  status: IrisReminderStatus;
  startedAt: string;
  finishedAt: string | null;
  due: number;
  messaged: number;
  notInSlack: number;
  failed: number;
  note: string | null;
  error: string | null;
};

const WHEN = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
export const formatWhen = (iso: string | null) => (iso ? WHEN.format(new Date(iso)) : "—");

const ERRORS: Record<string, string> = {
  already_running: "A run is already under way. Wait for it to finish.",
  not_configured: "Slack is not connected. A Training Administrator adds the app on Cohort Settings → Slack.",
  missing_scopes: "The Slack app cannot send direct messages yet. Add it again on Cohort Settings → Slack.",
  slack_error: "Slack refused the run.",
};

function message(body: { error?: string; detail?: string } | null, status: number) {
  const base = ERRORS[body?.error ?? ""] ?? `It did not run (${status}).`;
  return body?.detail ? `${base} ${body.detail}` : base;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** A run's result in a few words. */
export function RunResult({ run }: { run: ReminderRun }) {
  if (run.status === "running") return <span className="text-muted-foreground">Running…</span>;
  if (run.status === "failed") return <span className="text-destructive">Failed: {run.error ?? "no reason recorded"}</span>;
  if (run.status === "skipped") return <span className="text-muted-foreground">{run.note ?? "Nothing was due"}</span>;
  const parts = [`${plural(run.messaged, "person", "people")} ${run.dryRun ? "would be reminded" : "reminded"}`];
  if (run.notInSlack) parts.push(`${run.notInSlack.toLocaleString()} not in Slack`);
  if (run.failed) parts.push(`${run.failed.toLocaleString()} failed`);
  return (
    <span>
      {parts.join(", ")}
      {run.note && <span className="block text-xs text-muted-foreground">{run.note}</span>}
    </span>
  );
}

export function DiagnosticSlackView({
  configured,
  live,
  sentToday,
  assigned,
  due,
  schedule,
  running: inProgress,
  query,
  page,
}: {
  configured: boolean;
  live: boolean;
  sentToday: boolean;
  /** How many subjects are open, so Participants are asked to take them. */
  assigned: number;
  /** Participants with at least one of them left. */
  due: number;
  schedule: { text: string; enabled: boolean; nextRunAt: string | null } | null;
  running: boolean;
  query: ListQuery<IrisReminderRunSort>;
  page: Page<ReminderRun>;
}) {
  const router = useRouter();
  const rowLink = useRowLink();
  const sortProps = { sort: query.sort, dir: query.dir };
  const [busy, setBusy] = useState<"run" | "preview" | "live" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send(key: "run" | "preview" | "live", url: string, init: RequestInit) {
    setBusy(key);
    setError(null);
    try {
      const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...init });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(message(body, res.status));
        router.refresh();
        return null;
      }
      return body ?? {};
    } catch {
      setError("Could not reach the server.");
      return null;
    } finally {
      setBusy(null);
    }
  }

  /** Runs the reminders, or a dry run of them, then opens the run to show whom it messaged and what. */
  async function remind(preview: boolean) {
    if (
      !preview &&
      live &&
      !(await confirmDialog({
        title: "Send reminders now?",
        description: `Every Participant with tests left, ${plural(due, "person", "people")} now, gets a Slack message straight away, even if today's have already gone out. Preview shows what each would be sent without sending it.`,
        confirmLabel: "Send reminders",
      }))
    ) {
      return;
    }
    const body = await send(preview ? "preview" : "run", "/api/diagnostic/reminders", {
      method: "POST",
      body: JSON.stringify(preview ? { preview: true } : {}),
    });
    if (body?.runId) router.push(`/diagnostic-settings/slack/${body.runId}`);
  }

  async function setLive(next: boolean) {
    if (
      next &&
      !(await confirmDialog({
        title: "Put reminders live?",
        description: "From the next run, the daily schedule's and Remind Now's, every Participant with tests left gets a Slack message. Until then each run only logs what it would send.",
        confirmLabel: "Go live",
      }))
    ) {
      return;
    }
    if (await send("live", "/api/diagnostic/reminders/settings", { method: "PUT", body: JSON.stringify({ live: next }) })) {
      router.refresh();
    }
  }

  const running = busy === "run" || busy === "preview" || inProgress;

  return (
    <motion.div variants={staggerParent(0.05)} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={riseChild} className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-xl font-medium tracking-tight">Slack reminders</h2>
          <p className="text-sm text-muted-foreground tnum">
            {assigned === 0
              ? "No subject is open yet, so nobody is due a reminder"
              : `${plural(due, "Participant")} with tests left, of ${plural(assigned, "open subject")}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {/* In dry run every run is already a preview; live, this is the way to see one first. */}
          {live && (
            <Button variant="outline" disabled={running} onClick={() => void remind(true)}>
              {busy === "preview" ? <Loader2 className="animate-spin" /> : <Eye />}
              Preview
            </Button>
          )}
          <Button
            variant="brand"
            disabled={running || (live && !configured)}
            title={live ? undefined : "A dry run: logs whom it would remind, and what it would say, without sending anything"}
            onClick={() => void remind(false)}
          >
            {busy === "run" || (inProgress && busy === null) ? <Loader2 className="animate-spin" /> : <Send />}
            {busy === "run" || (inProgress && busy === null) ? "Reminding…" : "Remind Now"}
          </Button>
        </div>
      </motion.div>

      {error && (
        <motion.p variants={riseChild} role="alert" className="text-sm text-destructive">
          {error}
        </motion.p>
      )}

      <motion.div variants={riseChild} className="divide-y overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-2.5">
          <span className="text-sm font-medium">Slack</span>
          <span className="text-sm text-muted-foreground">
            {configured ? "Connected" : "Not connected: a Training Administrator adds the app on Cohort Settings → Slack"}
          </span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-2.5">
          <span className="flex items-center gap-2 text-sm font-medium">
            Mode
            {live ? <Badge>Live</Badge> : <Badge variant="secondary">Dry run</Badge>}
          </span>
          <Button variant="outline" size="sm" disabled={busy === "live"} onClick={() => void setLive(!live)}>
            {busy === "live" && <Loader2 className="animate-spin" />}
            {live ? "Switch to dry run" : "Go live"}
          </Button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-2.5">
          <span className="flex items-center gap-2 text-sm font-medium">
            <CalendarClock className="size-3.5 text-muted-foreground" />
            Daily reminder
            {schedule && !schedule.enabled && <Badge variant="secondary">Off</Badge>}
          </span>
          <span className="text-sm text-muted-foreground">
            {!schedule
              ? "Not scheduled"
              : !schedule.enabled
                ? `${schedule.text}, switched off on Admin Settings → Timed Jobs`
                : live && sentToday
                  ? `${schedule.text}; today's have gone out`
                  : `${schedule.text}${schedule.nextRunAt ? `; next ${formatWhen(schedule.nextRunAt)}` : ""}`}
          </span>
        </div>
      </motion.div>

      <motion.div variants={riseChild}>
        <TableSearch value={query.q} placeholder="Search by who, status or error" label="Search the reminder log" />
      </motion.div>

      <motion.div variants={riseChild} className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-180 text-sm">
            <thead>
              <tr className={HEADER_ROW}>
                <SortHeader column="startedAt" {...sortProps}>
                  Started
                </SortHeader>
                <PlainHeader>Triggered by</PlainHeader>
                <SortHeader column="status" {...sortProps}>
                  Result
                </SortHeader>
                <PlainHeader className="w-24" />
              </tr>
            </thead>
            <tbody>
              {page.rows.map((run) => {
                const href = `/diagnostic-settings/slack/${run.id}`;
                return (
                  <tr key={run.id} className={`${LINK_ROW} align-top`} onClick={rowLink(href)}>
                    <td className="whitespace-nowrap px-5 py-2.5 tabular-nums">
                      <Link href={href} className="group-hover:underline">
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
                            {run.triggeredByName ?? "Someone since removed"}
                          </>
                        )}
                      </span>
                    </td>
                    <td className="px-5 py-2.5">
                      <RunResult run={run} />
                    </td>
                    <td className="whitespace-nowrap px-5 py-2.5 text-right">
                      {run.dryRun ? <Badge variant="secondary">Dry run</Badge> : <Badge>Live</Badge>}
                    </td>
                  </tr>
                );
              })}
              {page.rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-5 py-8 text-center text-muted-foreground">
                    {query.q ? "No runs match." : "No reminders have run yet."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="border-t empty:hidden">
          <Pager page={page} noun="runs" />
        </div>
      </motion.div>
    </motion.div>
  );
}
