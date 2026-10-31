"use client";

/**
 * Google Meetings: any account the sync still needs connected, whom it adds,
 * and whether it is live or a dry run, in one card; then the meetings picked from the
 * Revenue Enablement calendar, each opening to be changed, or the sync's log;
 * and Preview and Sync Now, which add the cohort to each meeting's next
 * occurrence before their bootcamp.
 */

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Eye,
  FlaskConical,
  Loader2,
  MinusCircle,
  Plus,
  RefreshCw,
  Trash2,
  User,
  XCircle,
} from "lucide-react";
import { HEADER_ROW, LINK_ROW, Pager, PlainHeader, SortHeader, TableSearch, useRowLink } from "@/components/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { MeetingSyncStatus } from "@/db/schema";
import type { GoogleMeetingsOverview } from "@/lib/evals/google-meetings";
import { MEETING_STAGE_LABELS, MEETING_TRACK_LABELS, timezoneRangeLabel } from "@/lib/evals/meeting-plan";
import type { MeetingSelectionSort, MeetingSyncSort } from "@/lib/list-specs";
import { riseChild, staggerParent } from "@/lib/motion";
import type { ListQuery, Page } from "@/lib/paging";
import { cn } from "@/lib/utils";
import { formatDate, formatWhen } from "../../cohort-settings/format";
import { AdministratorsSection } from "./administrators-section";
import { MeetingDialog, type EditableMeeting } from "./meeting-dialog";

export type MeetingListing = EditableMeeting & {
  syncedAt: string | null;
  nextStartsAt: string | null;
  upcoming: number;
  invited: number;
  attended: number;
  addedBy: string | null;
  createdAt: string;
};

export type MeetingRun = {
  id: string;
  trigger: "schedule" | "manual";
  triggeredBy: string | null;
  status: MeetingSyncStatus;
  dryRun: boolean;
  testGroup: boolean;
  startedAt: string;
  finishedAt: string | null;
  invited: number;
  removed: number;
  attended: number;
  missed: number;
  noneLeft: number;
  failures: number;
  unfinished: boolean;
  error: string | null;
  notes: string[];
};

type WithDate<T, K extends keyof T> = Omit<T, K> & { [P in K]: string };

export type Overview = Omit<GoogleMeetingsOverview, "connection" | "zoom" | "lastLiveSync"> & {
  connection: WithDate<NonNullable<GoogleMeetingsOverview["connection"]>, "connectedAt"> | null;
  zoom: {
    configured: boolean;
    connection: WithDate<NonNullable<GoogleMeetingsOverview["zoom"]["connection"]>, "connectedAt"> | null;
  };
  lastLiveSync: WithDate<NonNullable<GoogleMeetingsOverview["lastLiveSync"]>, "finishedAt"> | null;
};

type List =
  | { view: "meetings"; query: ListQuery<MeetingSelectionSort>; page: Page<MeetingListing> }
  | { view: "runs"; query: ListQuery<MeetingSyncSort>; page: Page<MeetingRun> };

const SYNC_ERRORS: Record<string, string> = {
  not_connected: "Connect a Google account first, under Admin Settings → External Connectors.",
  not_configured: "The app's Google OAuth client is not set up here.",
  already_running: "A sync is already running — its result will appear in the sync log.",
  revoked: "Google no longer accepts the connected account's token. A platform administrator connects it again under Admin Settings → External Connectors.",
  google_error: "Google refused the sync.",
  forbidden: "Your own role changed — reload the page.",
};

const DELETE_ERRORS: Record<string, string> = {
  not_found: "That meeting was already deleted — reload the page.",
  running: "A sync is running. Try again once it finishes.",
  not_connected: "Its invites can't be taken back until a Google account is connected again, under Admin Settings → External Connectors.",
  remote_failed: "Google would not take back its invites.",
  forbidden: "Your own role changed — reload the page.",
};

function message(errors: Record<string, string>, body: { error?: string; detail?: string } | null, status: number) {
  const text = errors[body?.error ?? ""] ?? `Something went wrong (${status}).`;
  return body?.detail ? `${text} ${body.detail}` : text;
}

function plural(n: number, one: string, many = `${one}s`) {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

/** "12 invited, 2 taken off, 5 attended, 1 missed, 3 with none left", leaving out the zeros; "No changes" for none. */
export function meetingRunCounts(
  run: Pick<MeetingRun, "invited" | "removed" | "attended" | "missed" | "noneLeft" | "failures" | "dryRun">,
): string {
  const parts = [
    run.invited && `${run.invited.toLocaleString()} ${run.dryRun ? "to invite" : "invited"}`,
    run.removed && `${run.removed.toLocaleString()} ${run.dryRun ? "to take off" : "taken off"}`,
    run.attended && `${run.attended.toLocaleString()} attended`,
    run.missed && `${run.missed.toLocaleString()} missed`,
    run.noneLeft && `${run.noneLeft.toLocaleString()} with none left`,
    run.failures && plural(run.failures, "failure"),
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : "No changes";
}

export function MeetingRunResult({ run }: { run: MeetingRun }) {
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
        {run.error ?? run.notes[0] ?? "Skipped"}
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
        {meetingRunCounts(run)}
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

const VIEWS = [
  { view: "meetings", label: "Meetings" },
  { view: "runs", label: "Sync log" },
] as const;

export function GoogleMeetingsView({ overview, list }: { overview: Overview; list: List }) {
  const router = useRouter();
  const pathname = usePathname();
  const { connection, zoom, administrators, live, testGroup, cutoff, lastLiveSync, legacyMeetings } = overview;

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<EditableMeeting | null>(null);
  const [deleting, setDeleting] = useState<MeetingListing | null>(null);
  const [busy, setBusy] = useState<"sync" | "preview" | "mode" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function open(meeting: EditableMeeting | null) {
    setEditing(meeting);
    setDialogOpen(true);
  }

  /** Runs the sync, or with `preview` a dry run of it, then opens the run to show whom it invited or would have. */
  async function sync(preview: boolean) {
    if (
      !preview &&
      live &&
      !window.confirm(
        "Sync now? Everyone each meeting is for is added to its next occurrence before the bootcamp, where it shows up on their calendar without an email. Preview shows what it would do without doing it.",
      )
    ) {
      return;
    }
    setBusy(preview ? "preview" : "sync");
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/evals/google-meetings/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(preview ? { preview: true } : {}),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(message(SYNC_ERRORS, body, res.status));
        // A failed run is logged too.
        router.refresh();
      } else {
        router.push(`/evals-settings/google-meetings/runs/${body.runId}`);
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
        "Go live? From the next sync, Google Calendar invites go to the cohort and the Assessments Administrators, those it invited who no longer belong are taken off, and any meetings left from the old form are cancelled.",
      )
    ) {
      return;
    }
    setBusy("mode");
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/evals/google-meetings/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ live: next }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) setError(message(SYNC_ERRORS, body, res.status));
      else router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(null);
    }
  }

  async function remove(meeting: MeetingListing) {
    setBusy("delete");
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/evals/google-meetings/${meeting.id}`, { method: "DELETE" });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(message(DELETE_ERRORS, body, res.status));
        return;
      }
      const events = typeof body?.events === "number" ? body.events : 0;
      setNotice(`Deleted “${meeting.name}”${events > 0 ? ` and took the sync's guests off ${plural(events, "upcoming invite")}` : ""}.`);
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(null);
      setDeleting(null);
    }
  }

  const running = busy === "sync" || busy === "preview" || overview.running;
  const syncLabel = busy === "sync" || (overview.running && busy === null);

  return (
    <motion.div variants={staggerParent(0.05)} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={riseChild} className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-xl font-medium tracking-tight">Google Meetings</h2>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{plural(overview.meetingCount, "meeting")}</span>
            {connection ? <>, invites from {connection.email}</> : <>, and no Google account connected</>}
            {lastLiveSync && <> · last live sync {formatWhen(lastLiveSync.finishedAt)}</>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {/* In dry run every sync is already a preview; live, this is the way to see one first. */}
          {live && (
            <Button
              variant="outline"
              disabled={running || !connection}
              title="A dry run: see whom a sync would invite and take off, without doing any of it"
              onClick={() => sync(true)}
            >
              {busy === "preview" ? <Loader2 className="animate-spin" /> : <Eye />}
              Preview
            </Button>
          )}
          <Button
            variant="brand"
            // Even a dry run reads the calendar, so both need Google.
            disabled={running || !connection}
            title={
              !connection
                ? "Connect a Google account first, under Admin Settings → External Connectors"
                : live
                  ? undefined
                  : "A dry run: logs whom it would invite and take off, without doing any of it"
            }
            onClick={() => sync(false)}
          >
            {syncLabel ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            {syncLabel ? "Syncing…" : "Sync Now"}
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

      {testGroup.on && (
        <motion.div
          variants={riseChild}
          className="flex items-start gap-2.5 rounded-2xl border border-amber-300/70 bg-amber-50 px-5 py-4 text-sm text-amber-900 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200"
        >
          <FlaskConical className="mt-0.5 size-4 shrink-0" />
          <span>
            The test group is on, so each sync invites its {plural(testGroup.members, "person", "people")}{" "}
            (<span className="font-mono">-{testGroup.suffix}</span>) instead of the cohort, and no administrators. Turn it off on
            the Cohorts page&apos;s Current tab, which takes its invites back.
          </span>
        </motion.div>
      )}

      <motion.div variants={riseChild} className="divide-y overflow-hidden rounded-2xl border bg-card text-sm shadow-sm">
        {!connection && (
          <div className="space-y-0.5 px-5 py-4">
            <p className="flex items-center gap-2 font-medium">
              Google account
              <Badge variant="secondary">Not connected</Badge>
            </p>
            <p className="text-muted-foreground">None yet. A platform administrator connects it under Admin Settings → External Connectors.</p>
          </div>
        )}
        {!zoom.connection && (
          <div className="space-y-0.5 px-5 py-4">
            <p className="flex items-center gap-2 font-medium">
              Zoom user
              <Badge variant="secondary">Not connected</Badge>
            </p>
            <p className="text-muted-foreground">
              {zoom.configured
                ? "None yet, so attendance is only what administrators mark on the Cohorts page's Current tab. A platform administrator connects one under Admin Settings → External Connectors."
                : "Zoom is not set up here, so attendance is only what administrators mark on the Cohorts page's Current tab."}
            </p>
          </div>
        )}
        <AdministratorsSection administrators={administrators} />
        <div className="space-y-0.5 px-5 py-4">
          <p className="font-medium">Invite window</p>
          <p className="text-muted-foreground">
            {cutoff
              ? `Occurrences before ${formatDate(cutoff)}, when the active bootcamp starts. Anyone who misses one is invited to the next; with none left, the Current tab shows a red mark.`
              : "No bootcamp is active in the Scheduler, so each sync skips itself."}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4 sm:flex-nowrap">
          <div className="min-w-0 space-y-0.5">
            <p className="font-medium">Mode</p>
            <p className="text-muted-foreground">
              {live
                ? "Each sync adds people to their next occurrence, and takes off anyone it invited who no longer belongs. Google emails no one about it."
                : "Each sync reads the calendar and Zoom and logs whom it would invite and take off, without changing any invite."}
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
        {legacyMeetings > 0 && (
          <div className="flex items-start gap-2 px-5 py-4 text-muted-foreground">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
            <span>
              {plural(legacyMeetings, "meeting")} from the old form {legacyMeetings === 1 ? "is" : "are"} still on the eVals Meetings
              calendar. The next live sync cancels {legacyMeetings === 1 ? "its invite" : "their invites"}.
            </span>
          </div>
        )}
        {lastLiveSync?.status === "failed" && lastLiveSync.error && (
          <div className="flex items-start gap-2 bg-destructive/5 px-5 py-4 text-destructive">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>The last live sync stopped: {lastLiveSync.error}</span>
          </div>
        )}
      </motion.div>

      <motion.div variants={riseChild} className="flex flex-wrap items-center gap-3">
        <nav aria-label="Show" className="inline-flex rounded-lg border bg-card p-0.5 shadow-xs">
          {VIEWS.map(({ view, label }) => (
            <Link
              key={view}
              href={view === "meetings" ? pathname : `${pathname}?view=${view}`}
              scroll={false}
              aria-current={list.view === view ? "page" : undefined}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50",
                list.view === view ? "bg-accent font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </Link>
          ))}
        </nav>
        {list.view === "meetings" ? (
          <>
            <TableSearch value={list.query.q} placeholder="Search by name" label="Search meetings" className="min-w-56 flex-1" />
            <Button variant="outline" onClick={() => open(null)}>
              <Plus />
              Add meeting
            </Button>
          </>
        ) : (
          <TableSearch value={list.query.q} placeholder="Search by who, status or error" label="Search the sync log" className="min-w-56 flex-1" />
        )}
      </motion.div>

      {list.view === "meetings" ? (
        <MeetingsTable list={list} busy={busy === "delete"} onOpen={open} onDelete={setDeleting} />
      ) : (
        <RunsTable list={list} />
      )}

      <MeetingDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        onSaved={(name) => {
          setNotice(`Saved “${name}”. Sync Now to invite the cohort.`);
          router.refresh();
        }}
      />

      <Dialog open={deleting !== null} onOpenChange={(next) => !next && busy !== "delete" && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete “{deleting?.name}”?</DialogTitle>
            <DialogDescription className="leading-relaxed">
              {deleting?.syncedAt
                ? "Everyone the sync added to its upcoming occurrences is taken off, and Google tells them. The calendar event itself stays, and so does anyone else on it. Its attendance marks on the Current tab go."
                : "No sync has invited anyone to it, so nobody is told."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={busy === "delete"} onClick={() => setDeleting(null)}>
              Keep it
            </Button>
            <Button type="button" variant="destructive" disabled={busy === "delete"} onClick={() => deleting && remove(deleting)}>
              {busy === "delete" && <Loader2 className="animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}

function MeetingsTable({
  list: { query, page },
  busy,
  onOpen,
  onDelete,
}: {
  list: Extract<List, { view: "meetings" }>;
  busy: boolean;
  onOpen: (meeting: EditableMeeting) => void;
  onDelete: (meeting: MeetingListing) => void;
}) {
  const rowLink = useRowLink();
  const sortProps = { sort: query.sort, dir: query.dir };
  return (
    <motion.div variants={riseChild} className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full min-w-180 text-sm">
          <thead>
            <tr className={HEADER_ROW}>
              <SortHeader column="name" {...sortProps}>
                Meeting
              </SortHeader>
              <SortHeader column="stage" {...sortProps}>
                Stage
              </SortHeader>
              <SortHeader column="track" {...sortProps}>
                Track
              </SortHeader>
              <PlainHeader>Next</PlainHeader>
              <PlainHeader>Invited</PlainHeader>
              <PlainHeader className="w-16" />
            </tr>
          </thead>
          <tbody>
            {page.rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-8 text-center text-muted-foreground">
                  {query.q ? "No meetings match that search." : "No meetings yet. Add one from the Revenue Enablement calendar."}
                </td>
              </tr>
            )}
            {page.rows.map((m) => (
              <tr key={m.id} className={LINK_ROW} onClick={rowLink(() => onOpen(m))}>
                <td className="px-5 py-3">
                  <button type="button" onClick={() => onOpen(m)} className="text-left font-medium group-hover:underline">
                    {m.name}
                  </button>
                  {m.addedBy && <span className="block text-xs text-muted-foreground">Added by {m.addedBy}</span>}
                </td>
                <td className="whitespace-nowrap px-5 py-3 text-muted-foreground">
                  {MEETING_STAGE_LABELS[m.stage]}
                  {m.allOccurrences && <span className="block text-xs">All meetings until {MEETING_STAGE_LABELS[m.stage]}</span>}
                </td>
                <td className="whitespace-nowrap px-5 py-3 text-muted-foreground">
                  {MEETING_TRACK_LABELS[m.track]}
                  {m.timezoneFrom !== null && m.timezoneTo !== null && (
                    <span className="block text-xs tabular-nums">{timezoneRangeLabel(m.timezoneFrom, m.timezoneTo)}</span>
                  )}
                  {m.minDaysAfterStart > 0 && <span className="block text-xs tabular-nums">{m.minDaysAfterStart}+ days after start</span>}
                </td>
                <td className="whitespace-nowrap px-5 py-3 text-muted-foreground">
                  {m.nextStartsAt ? (
                    <>
                      {formatWhen(m.nextStartsAt)}
                      {m.upcoming > 1 && <span className="block text-xs tabular-nums">{m.upcoming.toLocaleString()} to come</span>}
                    </>
                  ) : m.syncedAt ? (
                    "None to come"
                  ) : (
                    "Not synced yet"
                  )}
                </td>
                <td className="whitespace-nowrap px-5 py-3 tabular-nums text-muted-foreground">
                  {m.syncedAt ? (
                    <>
                      {m.invited.toLocaleString()} invited
                      <span className="block text-xs">{m.attended.toLocaleString()} attended</span>
                    </>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-5 py-3">
                  <div className="flex justify-end">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete ${m.name}`}
                      disabled={busy}
                      className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => onDelete(m)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="border-t empty:hidden">
        <Pager page={page} noun="meetings" />
      </div>
    </motion.div>
  );
}

function RunsTable({ list: { query, page } }: { list: Extract<List, { view: "runs" }> }) {
  const rowLink = useRowLink();
  const sortProps = { sort: query.sort, dir: query.dir };
  return (
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
              <PlainHeader className="w-40" />
            </tr>
          </thead>
          <tbody>
            {page.rows.map((run) => (
              <tr
                key={run.id}
                className={`${LINK_ROW} align-top`}
                onClick={rowLink(`/evals-settings/google-meetings/runs/${run.id}`)}
              >
                <td className="whitespace-nowrap px-5 py-2.5 tabular-nums">
                  <Link href={`/evals-settings/google-meetings/runs/${run.id}`} className="group-hover:underline">
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
                  <MeetingRunResult run={run} />
                </td>
                <td className="whitespace-nowrap px-5 py-2.5 text-right">
                  <span className="inline-flex gap-1.5">
                    {run.testGroup && <Badge variant="outline">Test group</Badge>}
                    {run.dryRun && <Badge variant="secondary">Dry run</Badge>}
                  </span>
                </td>
              </tr>
            ))}
            {page.rows.length === 0 && (
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
  );
}
