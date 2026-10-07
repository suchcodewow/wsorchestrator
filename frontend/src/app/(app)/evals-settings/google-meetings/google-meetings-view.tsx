"use client";

/**
 * Google Meetings: the account invites go out from, Zoom, and who is on every
 * invite, in one card; then the meetings, a page at a time, each opening to be
 * changed; and Sync Now, which sends them all to Google Calendar and Zoom.
 */

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { AlertTriangle, ExternalLink, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { HEADER_ROW, LINK_ROW, Pager, PlainHeader, SortHeader, TableSearch, useRowLink } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { MeetingGroup } from "@/db/schema";
import type { GoogleMeetingsOverview, MeetingWhen } from "@/lib/evals/google-meetings";
import {
  MEETING_GROUP_LABELS,
  MEETING_LENGTH_LABELS,
  isMeetingLength,
  type MeetingStatus,
} from "@/lib/evals/google-meetings-plan";
import type { MeetingSyncOutcome } from "@/lib/evals/google-meetings-sync";
import type { GoogleMeetingSort } from "@/lib/list-specs";
import { riseChild, staggerParent } from "@/lib/motion";
import type { ListQuery, Page } from "@/lib/paging";
import { cn } from "@/lib/utils";
import { formatWhen } from "../../cohort-settings/format";
import { MeetingDialog, type EditableMeeting } from "./meeting-dialog";

export type MeetingListing = EditableMeeting & {
  zoomJoinUrl: string | null;
  status: MeetingStatus;
  syncError: string | null;
  syncedAt: string | null;
  invited: number;
  addedBy: string | null;
};

type Overview = Omit<GoogleMeetingsOverview, "connection"> & {
  connection:
    | (Omit<NonNullable<GoogleMeetingsOverview["connection"]>, "connectedAt" | "lastSyncAt"> & {
        connectedAt: string;
        lastSyncAt: string | null;
      })
    | null;
};

const STATUS: Record<MeetingStatus, { label: string; chip: string }> = {
  not_synced: { label: "Not synced", chip: "bg-slate-100 text-slate-700 dark:bg-slate-400/15 dark:text-slate-300" },
  synced: { label: "Invite sent", chip: "bg-emerald-100 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300" },
  changed: { label: "Changed since sync", chip: "bg-amber-100 text-amber-800 dark:bg-amber-400/15 dark:text-amber-300" },
  failed: { label: "Sync failed", chip: "bg-red-100 text-red-700 dark:bg-red-400/15 dark:text-red-300" },
};

/** What the consent screen came back with, from the callback's `?google=`. */
const RETURNED: Record<string, { tone: "ok" | "error"; text: (current: string | null) => string }> = {
  connected: { tone: "ok", text: () => "Connected. Sync Now sends the invites from this account." },
  denied: { tone: "error", text: () => "Google was not given access, so nothing changed." },
  expired: { tone: "error", text: () => "That sign-in took too long or started in another tab. Connect again." },
  failed: { tone: "error", text: () => "Google did not finish connecting. Connect again." },
  scope: { tone: "error", text: () => "The account was connected without calendar access. Connect again and allow it." },
  different_account: {
    tone: "error",
    text: (current) =>
      `Meetings already have invites from ${current ?? "the connected account"}. Connect that account again, or delete those meetings first.`,
  },
};

const SYNC_ERRORS: Record<string, string> = {
  not_connected: "Connect a Google account first.",
  not_configured: "The app's Google OAuth client is not set up here.",
  running: "A sync is already running. Give it a minute.",
  revoked: "Google no longer accepts the connected account's token. Connect it again.",
  forbidden: "Your own role changed — reload the page.",
};

const DELETE_ERRORS: Record<string, string> = {
  not_found: "That meeting was already deleted — reload the page.",
  not_connected: "Its invite can't be cancelled until a Google account is connected again.",
  remote_failed: "Google or Zoom would not cancel it.",
  forbidden: "Your own role changed — reload the page.",
};

type SyncSummary = { meetings: MeetingSyncOutcome[]; notes: string[] };

export function GoogleMeetingsView({
  query,
  when,
  page,
  overview,
  returned,
}: {
  query: ListQuery<GoogleMeetingSort>;
  when: MeetingWhen;
  page: Page<MeetingListing>;
  overview: Overview;
  returned: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const rowLink = useRowLink();
  const sortProps = { sort: query.sort, dir: query.dir };
  const { connection, zoomConfigured, administrators, counts, groupSizes } = overview;

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<EditableMeeting | null>(null);
  const [deleting, setDeleting] = useState<MeetingListing | null>(null);
  const [busy, setBusy] = useState<"sync" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [summary, setSummary] = useState<SyncSummary | null>(null);
  const shownReturn = returned ? RETURNED[returned] : undefined;

  function open(meeting: EditableMeeting | null) {
    setEditing(meeting);
    setDialogOpen(true);
  }

  function show(next: MeetingWhen) {
    const p = new URLSearchParams(params.toString());
    p.delete("page");
    p.delete("google");
    p.delete("current");
    if (next === "upcoming") p.delete("when");
    else p.set("when", next);
    const qs = p.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  async function syncNow() {
    setBusy("sync");
    setError(null);
    setNotice(null);
    setSummary(null);
    try {
      const res = await fetch("/api/evals/google-meetings/sync", { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(SYNC_ERRORS[body?.error ?? ""] ?? `Sync failed (${res.status}): ${body?.detail ?? "no detail"}`);
      } else {
        setSummary({ meetings: body.meetings, notes: body.notes });
      }
      router.refresh();
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
        const known = DELETE_ERRORS[body?.error ?? ""];
        setError(known ? `${known}${body?.detail ? ` ${body.detail}` : ""}` : `Could not delete (${res.status}).`);
        return;
      }
      setNotice(`Deleted “${meeting.title}”${meeting.status === "not_synced" || when === "past" ? "" : " and cancelled its invite"}.`);
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(null);
      setDeleting(null);
    }
  }

  const tally = summary && {
    created: summary.meetings.filter((m) => m.outcome === "created").length,
    updated: summary.meetings.filter((m) => m.outcome === "updated").length,
    unchanged: summary.meetings.filter((m) => m.outcome === "unchanged").length,
    failed: summary.meetings.filter((m) => m.outcome === "failed"),
  };

  return (
    <motion.div variants={staggerParent(0.05)} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={riseChild} className="flex flex-col items-start gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1.5">
          <h2 className="text-xl font-medium tracking-tight">Google Meetings</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">
              {counts.upcoming.toLocaleString()} upcoming {counts.upcoming === 1 ? "meeting" : "meetings"}
            </span>
            {connection ? <>, sent from {connection.email}</> : <>, and no Google account connected</>}
            {connection?.lastSyncAt && <> · last synced {formatWhen(connection.lastSyncAt)}</>}
          </p>
        </div>
        <Button
          variant="brand"
          disabled={!connection || connection.running || busy === "sync"}
          title={connection ? undefined : "Connect a Google account first"}
          onClick={syncNow}
        >
          {busy === "sync" || connection?.running ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          {busy === "sync" || connection?.running ? "Syncing…" : "Sync Now"}
        </Button>
      </motion.div>

      <motion.div variants={riseChild} className="divide-y overflow-hidden rounded-2xl border bg-card text-sm shadow-sm">
        <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-0.5">
            <div className="font-medium">Google account</div>
            <div className="text-muted-foreground">
              {connection ? (
                <>
                  {connection.email}, connected {formatWhen(connection.connectedAt)}
                  {connection.connectedBy && <> by {connection.connectedBy}</>}
                </>
              ) : (
                "None yet. Sign in as the account the invites should come from."
              )}
            </div>
          </div>
          {/* A full page load, not a client navigation: the route sends the browser on to Google. */}
          <Button
            variant={connection ? "outline" : "brand"}
            size="sm"
            onClick={() => window.location.assign("/api/evals/google-meetings/connect")}
          >
            {connection ? "Reconnect" : "Connect Google account"}
          </Button>
        </div>
        <div className="space-y-0.5 px-5 py-4">
          <div className="font-medium">Zoom</div>
          <div className="text-muted-foreground">
            {zoomConfigured
              ? "Each invite gets a Zoom link, with the administrators below as alternative hosts."
              : "Not set up here, so invites go out with no Zoom link."}
          </div>
        </div>
        <div className="space-y-0.5 px-5 py-4">
          <div className="font-medium">
            {administrators.length.toLocaleString()} Assessments {administrators.length === 1 ? "Administrator" : "Administrators"}
          </div>
          <div className="text-muted-foreground">
            {administrators.length
              ? `On every invite, and can edit it: ${administrators.join(", ")}`
              : "Nobody holds the role, so invites go to the cohort alone."}
          </div>
        </div>
        {connection?.lastSyncError && (
          <div className="flex items-start gap-2 bg-destructive/5 px-5 py-4 text-destructive">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>The last sync stopped: {connection.lastSyncError}</span>
          </div>
        )}
      </motion.div>

      {shownReturn && (
        <motion.p
          variants={riseChild}
          role={shownReturn.tone === "error" ? "alert" : "status"}
          className={cn("text-sm", shownReturn.tone === "error" ? "text-destructive" : "text-muted-foreground")}
        >
          {shownReturn.text(params.get("current"))}
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

      {tally && (
        <motion.div variants={riseChild} initial="hidden" animate="show" className="divide-y rounded-2xl border bg-card text-sm shadow-sm">
          <div className="px-5 py-4">
            <span className="font-medium">
              Synced {summary!.meetings.length.toLocaleString()} {summary!.meetings.length === 1 ? "meeting" : "meetings"}:
            </span>{" "}
            <span className="text-muted-foreground">
              {tally.created} created, {tally.updated} updated, {tally.unchanged} already up to date
              {tally.failed.length > 0 && <>, {tally.failed.length} failed</>}.
            </span>
          </div>
          {tally.failed.map((m) => (
            <div key={m.id} className="px-5 py-3 text-destructive">
              <span className="font-medium">{m.title}:</span> {m.error}
            </div>
          ))}
          {summary!.notes.map((note) => (
            <div key={note} className="flex items-start gap-2 px-5 py-3 text-muted-foreground">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
              <span>{note}</span>
            </div>
          ))}
        </motion.div>
      )}

      <motion.div variants={riseChild} className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <TableSearch value={query.q} placeholder="Search by title" label="Search meetings" className="sm:flex-1" />
        <div role="radiogroup" aria-label="Which meetings" className="flex h-9 w-fit overflow-hidden rounded-md border">
          {(["upcoming", "past"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={when === value}
              className={cn(
                "px-4 text-sm transition-colors",
                when === value
                  ? "bg-secondary text-secondary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )}
              onClick={() => show(value)}
            >
              {value === "upcoming" ? "Upcoming" : "Past"} <span className="tnum text-xs">{counts[value].toLocaleString()}</span>
            </button>
          ))}
        </div>
        <Button variant="outline" onClick={() => open(null)}>
          <Plus />
          New meeting
        </Button>
      </motion.div>

      <motion.div variants={riseChild} className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-200 text-sm">
            <thead>
              <tr className={HEADER_ROW}>
                <SortHeader column="title" {...sortProps}>
                  Title
                </SortHeader>
                <SortHeader column="startsAt" {...sortProps}>
                  Starts
                </SortHeader>
                <SortHeader column="durationMinutes" {...sortProps}>
                  Length
                </SortHeader>
                <PlainHeader>Invites</PlainHeader>
                <PlainHeader>Status</PlainHeader>
                <PlainHeader>Zoom</PlainHeader>
                <PlainHeader className="w-16" />
              </tr>
            </thead>
            <tbody>
              {page.rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-8 text-center text-muted-foreground">
                    {query.q ? "No meetings match that search." : when === "upcoming" ? "No upcoming meetings." : "No past meetings."}
                  </td>
                </tr>
              )}
              {page.rows.map((m) => (
                <tr key={m.id} className={LINK_ROW} onClick={rowLink(() => open(m))}>
                  <td className="px-5 py-3">
                    <button type="button" onClick={() => open(m)} className="text-left font-medium group-hover:underline">
                      {m.title}
                    </button>
                  </td>
                  <td className="px-5 py-3 whitespace-nowrap text-muted-foreground">{formatWhen(m.startsAt)}</td>
                  <td className="px-5 py-3 whitespace-nowrap text-muted-foreground">
                    {isMeetingLength(m.durationMinutes) ? MEETING_LENGTH_LABELS[m.durationMinutes] : `${m.durationMinutes}m`}
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">
                    {m.groups.length ? m.groups.map((g: MeetingGroup) => MEETING_GROUP_LABELS[g]).join(", ") : "Administrators only"}
                    {m.syncedAt && <span className="block text-xs tnum">{m.invited.toLocaleString()} invited</span>}
                  </td>
                  <td className="px-5 py-3">
                    <span
                      title={m.syncError ?? (m.syncedAt ? `Synced ${formatWhen(m.syncedAt)}` : undefined)}
                      className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", STATUS[m.status].chip)}
                    >
                      {STATUS[m.status].label}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    {m.zoomJoinUrl ? (
                      <a
                        href={m.zoomJoinUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-brand hover:underline"
                      >
                        Join <ExternalLink className="size-3" />
                      </a>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex justify-end">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Delete ${m.title}`}
                        disabled={busy === "delete"}
                        className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => setDeleting(m)}
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

      <MeetingDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        groupSizes={groupSizes}
        onSaved={(title) => {
          setNotice(`Saved “${title}”. Sync Now to send it.`);
          router.refresh();
        }}
      />

      <Dialog open={deleting !== null} onOpenChange={(next) => !next && busy !== "delete" && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete “{deleting?.title}”?</DialogTitle>
            <DialogDescription className="leading-relaxed">
              {deleting?.status === "not_synced"
                ? "Nothing was sent for it, so nobody is told."
                : when === "past"
                  ? "It has ended, so its invite stays in everyone's calendar and nobody is told."
                  : "Its Google Calendar invite and Zoom meeting are cancelled, and everyone invited is told."}
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
