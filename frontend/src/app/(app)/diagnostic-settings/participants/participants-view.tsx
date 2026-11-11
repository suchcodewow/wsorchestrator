"use client";

/**
 * The Participants: Bootcamp Auto-Enroll and adding someone by hand above
 * them, then a row per person with how far they have got. Their placements
 * are on the Records tab. The hand-added can be removed here; the
 * auto-enrolled go when auto-enroll stops.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Loader2, UserPlus, X } from "lucide-react";
import { HEADER_ROW, Pager, PlainHeader, SortHeader, TableSearch } from "@/components/data-table";
import { EmployeePicker } from "@/components/employee-picker";
import { Button } from "@/components/ui/button";
import { confirmDialog } from "@/components/ui/confirm";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { AutoEnroll, ParticipantCounts, ParticipantRow } from "@/lib/iris/participants";
import { OPEN_SUBJECT_KEYS, TRACKS, type Track } from "@/lib/iris/subjects";
import type { IrisParticipantSort } from "@/lib/list-specs";
import { riseChild, staggerParent } from "@/lib/motion";
import type { ListQuery, Page } from "@/lib/paging";
import { cn } from "@/lib/utils";

type Row = Omit<ParticipantRow, "addedAt" | "finishedAt"> & { addedAt: string | null; finishedAt: string | null };
type AutoEnrollState = Omit<AutoEnroll, "changedAt"> & { changedAt: string | null };

const COLUMNS = 6;

const ERRORS: Record<string, string> = {
  invalid: "Pick someone from the list, or type a full email address.",
  unknown_person: "Only someone in the employee list from HiBob, or with an account here, can be added.",
  duplicate: "That person was already added.",
  not_found: "That person was already removed — reload the page.",
  forbidden: "Your own role changed — reload the page.",
};

const day = (iso: string) => new Date(iso).toLocaleDateString();

export function ParticipantsView({
  query,
  counts,
  autoEnroll,
  page,
}: {
  query: ListQuery<IrisParticipantSort>;
  counts: ParticipantCounts;
  autoEnroll: AutoEnrollState;
  page: Page<Row>;
}) {
  const router = useRouter();
  const sortProps = { sort: query.sort, dir: query.dir };
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [track, setTrack] = useState<Track | null>(null);

  /** Sends one change; refreshes the page and returns the body when it took, null when it did not. */
  async function send(key: string, url: string, init: RequestInit) {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...init });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(ERRORS[body?.error ?? ""] ?? `Could not save (${res.status}).`);
        return null;
      }
      router.refresh();
      return body ?? {};
    } catch {
      setError("Could not reach the server.");
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function toggleAutoEnroll() {
    const on = !autoEnroll.on;
    const ok = await confirmDialog(
      on
        ? {
            title: "Are you sure?",
            description: "This will enroll bootcamp attendees and start reminding them to take the Diagnostic.",
            confirmLabel: "Auto-Enroll",
          }
        : {
            title: "Are you sure?",
            description: "This will prevent attendees from starting new tests.",
            confirmLabel: "Stop Auto-Enroll",
            destructive: true,
          },
    );
    if (!ok) return;
    const body = await send("auto", "/api/diagnostic/auto-enroll", { method: "PUT", body: JSON.stringify({ on }) });
    if (body) {
      const n = (body.counts as ParticipantCounts | undefined)?.auto ?? 0;
      setNotice(on ? `Bootcamp Auto-Enroll is on: ${n} ${n === 1 ? "attendee" : "attendees"} enrolled.` : "Bootcamp Auto-Enroll is off.");
    }
  }

  async function remove(r: Row) {
    const who = r.name || r.email;
    const ok = await confirmDialog({
      title: `Remove ${who}?`,
      description: autoEnroll.on
        ? "They were added by hand. If Bootcamp Auto-Enroll counts them, they stay a Participant through it; otherwise they can no longer start a test. Their results are kept."
        : "They can no longer start a test. Their results are kept.",
      confirmLabel: "Remove",
      destructive: true,
    });
    if (!ok) return;
    const body = await send(r.email, "/api/diagnostic/participants", {
      method: "DELETE",
      body: JSON.stringify({ email: r.email }),
    });
    if (body) setNotice(`Removed ${who}.`);
  }

  return (
    <motion.div variants={staggerParent(0.05)} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={riseChild} className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-2.5">
          <p className="text-sm text-muted-foreground tnum">
            {autoEnroll.on ? (
              <>
                <span className="font-medium text-foreground">{counts.auto.toLocaleString()}</span> bootcamp{" "}
                {counts.auto === 1 ? "attendee" : "attendees"} enrolled
                {autoEnroll.changedAt && (
                  <>
                    {" "}
                    · on since {day(autoEnroll.changedAt)}
                    {autoEnroll.changedBy && <> by {autoEnroll.changedBy}</>}
                  </>
                )}
              </>
            ) : (
              <>
                Bootcamp Auto-Enroll is off
                {autoEnroll.changedAt && (
                  <>
                    {" "}
                    · since {day(autoEnroll.changedAt)}
                    {autoEnroll.changedBy && <> by {autoEnroll.changedBy}</>}
                  </>
                )}
              </>
            )}
          </p>
          <Button
            variant={autoEnroll.on ? "outline" : "brand"}
            size="sm"
            role="switch"
            aria-checked={autoEnroll.on}
            disabled={busy === "auto"}
            onClick={() => void toggleAutoEnroll()}
          >
            {busy === "auto" && <Loader2 className="animate-spin" />}
            {autoEnroll.on ? "Stop Bootcamp Auto-Enroll" : "Auto-Enroll Bootcamp Cohort"}
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

      <motion.div variants={riseChild} className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <TableSearch value={query.q} placeholder="Search by name or email" label="Search the Participants" />
        </div>
        <Button variant="outline" onClick={() => setAdding(true)}>
          <UserPlus />
          Add Participant
        </Button>
      </motion.div>

      <Dialog
        open={adding}
        onOpenChange={(open) => {
          setAdding(open);
          if (open) setTrack(null);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Participant</DialogTitle>
            <DialogDescription>
              They stay a Participant whether Bootcamp Auto-Enroll is on or off, until they are removed.
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Track</legend>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Track">
              {([null, ...TRACKS] as const).map((t) => (
                <button
                  key={t ?? "theirs"}
                  type="button"
                  role="radio"
                  aria-checked={track === t}
                  onClick={() => setTrack(t)}
                  className={cn(
                    "inline-flex h-8 items-center rounded-full border px-3 text-sm transition-colors",
                    track === t
                      ? "border-brand-border bg-brand-subtle font-medium text-foreground"
                      : "bg-card text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                  )}
                >
                  {t ?? "Let them choose"}
                </button>
              ))}
            </div>
          </fieldset>
          <EmployeePicker
            id="diagnostic-participant"
            label="Someone at Harness"
            placeholder="Search employees and test accounts by name or email"
            allowAnyEmail
            includeTestAccounts
            busy={busy === "add"}
            onAdd={async (email, fullName) => {
              const body = await send("add", "/api/diagnostic/participants", {
                method: "POST",
                body: JSON.stringify({ email, track }),
              });
              if (!body) return false;
              setAdding(false);
              setNotice(`Added ${body.fullName || fullName || body.email}.`);
              return true;
            }}
          />
        </DialogContent>
      </Dialog>

      <motion.div variants={riseChild} className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-200 text-sm">
            <thead>
              <tr className={HEADER_ROW}>
                <PlainHeader className="w-12" />
                <SortHeader column="person" {...sortProps}>
                  Participant · {counts.total.toLocaleString()}
                </SortHeader>
                <SortHeader column="added" {...sortProps}>
                  Enrolled
                </SortHeader>
                <SortHeader column="track" {...sortProps}>
                  Track
                </SortHeader>
                <SortHeader column="completed" {...sortProps}>
                  Done
                </SortHeader>
                <SortHeader column="finishedAt" {...sortProps}>
                  Last finished
                </SortHeader>
              </tr>
            </thead>
            <tbody>
              {page.rows.length === 0 && (
                <tr>
                  <td colSpan={COLUMNS} className="px-5 py-8 text-center text-muted-foreground">
                    {query.q ? (
                      <>No one matches &ldquo;{query.q}&rdquo;.</>
                    ) : (
                      "No Participants yet. Turn on Bootcamp Auto-Enroll or add someone."
                    )}
                  </td>
                </tr>
              )}
              {page.rows.map((r) => (
                <tr key={r.email} className="border-b transition-colors last:border-b-0 hover:bg-muted/30">
                  <td className="py-3 pl-3">
                    {r.manual && (
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Remove the hand-added Participant"
                        aria-label={`Remove ${r.name || r.email}`}
                        disabled={busy === r.email}
                        className="size-7 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => void remove(r)}
                      >
                        {busy === r.email ? <Loader2 className="size-3.5 animate-spin" /> : <X className="size-4" />}
                      </Button>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <span className="block font-medium">{r.name || r.email}</span>
                    {r.name && <span className="block truncate text-xs text-muted-foreground">{r.email}</span>}
                  </td>
                  <td className="px-5 py-3 whitespace-nowrap text-muted-foreground">{r.manual ? (r.addedBy ?? "—") : "Bootcamp"}</td>
                  <td className="px-5 py-3 text-muted-foreground">{r.track ?? "—"}</td>
                  <td className="px-5 py-3 text-muted-foreground tnum">
                    {r.completed} of {OPEN_SUBJECT_KEYS.length}
                  </td>
                  <td className="px-5 py-3 whitespace-nowrap text-muted-foreground tnum">
                    {r.finishedAt ? day(r.finishedAt) : !r.userId ? "Not signed in yet" : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t empty:hidden">
          <Pager page={page} noun="people" />
        </div>
      </motion.div>
    </motion.div>
  );
}
