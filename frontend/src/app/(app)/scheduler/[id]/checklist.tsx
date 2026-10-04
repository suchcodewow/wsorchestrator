"use client";

/**
 * What has to be done before a day of Bootcamp or Intermediate starts: a
 * button at the top of the day showing how much of it is ticked, opening the
 * list. A Training administrator adds and removes items and ticks any of
 * them; an item's owner ticks their own.
 */

import { useEffect, useState, type ReactNode } from "react";
import { ListChecks, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MentionText } from "@/components/mention-text";
import { MentionTextarea } from "@/components/mention-textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CHECKLIST_LIMITS, CHECKLIST_TRACKS, type ChecklistTrack } from "@/db/schema";
import { mentionsIn, type MentionPick } from "@/lib/mentions";
import type { ChecklistDayCount, ChecklistItemRow } from "@/lib/scheduler/checklist";
import type { Instructor } from "@/lib/scheduler/schedule";
import { TRACK_LABELS } from "@/lib/scheduler/timeline";
import { cn } from "@/lib/utils";
import { formatWhen } from "../../cohort-settings/format";
import type { BoardColumn } from "./board";

const ERRORS: Record<string, string> = {
  invalid: "Give the item a name.",
  not_found: "That item or bootcamp was removed — reload the page.",
  no_day: "That day is no longer part of the bootcamp — reload the page.",
  full: `A day holds at most ${CHECKLIST_LIMITS.itemsPerDay} items.`,
  not_instructor: "That person is no longer an administrator or guest judge here.",
  not_owner: "Only its owner or an administrator can tick that.",
  forbidden: "Your role changed — reload the page.",
};

/** A row as it arrives over JSON, its times as strings. */
type Item = Omit<ChecklistItemRow, "doneAt" | "createdAt"> & { doneAt: string | null; createdAt: string };

type Count = Pick<ChecklistDayCount, "total" | "done">;

const SELECT =
  "h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30";

/**
 * The board's `headerAction`: a checklist button atop each Bootcamp and
 * Intermediate day, and nothing atop the SE tracks, which share their class's.
 */
export function useChecklistButtons({
  bootcampId,
  counts,
  canManage,
  viewerEmail,
  instructors,
}: {
  bootcampId: string;
  counts: ChecklistDayCount[];
  canManage: boolean;
  viewerEmail: string;
  instructors: Instructor[];
}): (column: BoardColumn) => ReactNode {
  const [checks, setChecks] = useState(() => new Map(counts.map((c) => [`${c.track}:${c.day}`, c])));

  return function ChecklistAction(column) {
    const track = CHECKLIST_TRACKS.find((t) => t === column.track);
    if (!track) return null;
    const key = `${track}:${column.day}`;
    return (
      <ChecklistButton
        key={key}
        bootcampId={bootcampId}
        track={track}
        day={column.day}
        label={`${TRACK_LABELS[track]}, Day ${column.day}`}
        count={checks.get(key) ?? { total: 0, done: 0 }}
        canManage={canManage}
        viewerEmail={viewerEmail}
        instructors={instructors}
        onCount={(n) => setChecks((prev) => new Map(prev).set(key, { track, day: column.day, ...n }))}
      />
    );
  };
}

export function ChecklistButton({
  bootcampId,
  track,
  day,
  label,
  count,
  canManage,
  viewerEmail,
  instructors,
  onCount,
}: {
  bootcampId: string;
  track: ChecklistTrack;
  day: number;
  /** "Bootcamp, Day 2", for the dialog's title and the button's name. */
  label: string;
  count: Count;
  canManage: boolean;
  viewerEmail: string;
  instructors: Instructor[];
  onCount: (count: Count) => void;
}) {
  const [open, setOpen] = useState(false);
  const allDone = count.total > 0 && count.done === count.total;

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className={cn("h-7 shrink-0 gap-1 px-1.5 text-xs tabular-nums", allDone && "text-emerald-700 dark:text-emerald-400")}
        aria-label={`Checklist for ${label}: ${count.done} of ${count.total} done`}
        title="Checklist"
        onClick={() => setOpen(true)}
      >
        <ListChecks className="size-4" />
        {count.total > 0 && `${count.done}/${count.total}`}
      </Button>
      {open && (
        <ChecklistDialog
          onClose={() => setOpen(false)}
          bootcampId={bootcampId}
          track={track}
          day={day}
          label={label}
          canManage={canManage}
          viewerEmail={viewerEmail}
          instructors={instructors}
          onCount={onCount}
        />
      )}
    </>
  );
}

function ChecklistDialog({
  onClose,
  bootcampId,
  track,
  day,
  label,
  canManage,
  viewerEmail,
  instructors,
  onCount,
}: {
  onClose: () => void;
  bootcampId: string;
  track: ChecklistTrack;
  day: number;
  label: string;
  canManage: boolean;
  viewerEmail: string;
  instructors: Instructor[];
  onCount: (count: Count) => void;
}) {
  const base = `/api/scheduler/bootcamps/${bootcampId}/checklist`;
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [picks, setPicks] = useState<MentionPick[]>([]);
  const [owner, setOwner] = useState("");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const show = (next: Item[]) => {
    setItems(next);
    onCount({ total: next.length, done: next.filter((i) => i.done).length });
  };

  useEffect(() => {
    let live = true;
    void (async () => {
      const res = await fetch(`${base}/${track}/${day}`, { cache: "no-store" }).catch(() => null);
      const out = await res?.json().catch(() => null);
      if (!live) return;
      if (!res?.ok) return setError(ERRORS[out?.error ?? ""] ?? "Could not load the checklist.");
      show(out.items as Item[]);
    })();
    return () => {
      live = false;
    };
    // The dialog is mounted only while open, so this runs once each time it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, track, day]);

  async function send(url: string, init: RequestInit): Promise<unknown | null> {
    setError(null);
    try {
      const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json" } });
      const out = await res.json().catch(() => null);
      if (!res.ok) {
        setError(
          out?.error === "not_instructor" && out.email
            ? `${out.email} is no longer an administrator or guest judge here.`
            : (ERRORS[out?.error ?? ""] ?? `That did not save (${res.status}).`),
        );
        return null;
      }
      return out;
    } catch {
      setError("Could not reach the server.");
      return null;
    }
  }

  async function add() {
    if (!name.trim() || adding) return;
    setAdding(true);
    const out = await send(`${base}/${track}/${day}`, {
      method: "POST",
      body: JSON.stringify({ name, ownerEmail: owner || null, mentions: mentionsIn(name, picks).map((p) => p.email) }),
    });
    setAdding(false);
    if (!out) return;
    show([...(items ?? []), out as Item]);
    setName("");
    setPicks([]);
    setOwner("");
  }

  async function tick(item: Item) {
    setBusy(item.id);
    const out = await send(`${base}/items/${item.id}`, { method: "PATCH", body: JSON.stringify({ done: !item.done }) });
    setBusy(null);
    if (out) show((items ?? []).map((i) => (i.id === item.id ? (out as Item) : i)));
  }

  async function remove(item: Item) {
    if (!window.confirm(`Delete “${item.name}”?`)) return;
    setBusy(item.id);
    const out = await send(`${base}/items/${item.id}`, { method: "DELETE" });
    setBusy(null);
    if (out) show((items ?? []).filter((i) => i.id !== item.id));
  }

  const done = items?.filter((i) => i.done).length ?? 0;
  const admins = instructors.filter((i) => i.role === "administrator");
  const judges = instructors.filter((i) => i.role === "judge");

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{label} checklist</DialogTitle>
          {items && (
            <p className="text-sm text-muted-foreground tabular-nums">
              {items.length === 0 ? "Nothing on it yet" : `${done} of ${items.length} done`}
            </p>
          )}
        </DialogHeader>

        {items === null ? (
          !error && (
            <div className="flex justify-center py-6 text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
            </div>
          )
        ) : (
          items.length > 0 && (
            <ul className="divide-y rounded-lg border">
              {items.map((item) => {
                const mine = item.ownerEmail !== null && item.ownerEmail === viewerEmail.toLowerCase();
                const canTick = canManage || mine;
                return (
                  <li key={item.id} className="flex items-start gap-3 px-3 py-2.5">
                    <input
                      type="checkbox"
                      checked={item.done}
                      disabled={!canTick || busy === item.id}
                      onChange={() => void tick(item)}
                      aria-label={`${item.done ? "Untick" : "Tick"} ${item.name}`}
                      title={canTick ? undefined : "Only its owner or an administrator can tick this"}
                      className="mt-0.5 size-4 shrink-0 accent-brand disabled:cursor-not-allowed"
                    />
                    <div className="min-w-0 flex-1">
                      <div className={cn("text-sm wrap-break-word", item.done && "text-muted-foreground line-through")}>
                        <MentionText text={item.name} mentions={item.mentions} viewerEmail={viewerEmail} />
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {[
                          item.ownerEmail ? `Owner: ${item.ownerName || item.ownerEmail}${mine ? " (you)" : ""}` : "No owner",
                          `added by ${item.createdByName || item.createdByEmail || "someone removed"} ${formatWhen(item.createdAt)}`,
                          item.done && item.doneAt && `done by ${item.doneByName || "someone"} ${formatWhen(item.doneAt)}`,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    </div>
                    {canManage && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
                        aria-label={`Delete ${item.name}`}
                        disabled={busy === item.id}
                        onClick={() => void remove(item)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )
        )}

        {canManage && items !== null && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void add();
            }}
            className="grid gap-2 sm:grid-cols-[1fr_auto_auto]"
          >
            <MentionTextarea
              singleLine
              value={name}
              onChange={setName}
              people={instructors}
              onPick={(p) => setPicks((prev) => [...prev, p])}
              maxLength={CHECKLIST_LIMITS.name}
              placeholder="Add an item — @ to tag"
              aria-label="New item"
            />
            <select value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Owner" className={SELECT}>
              <option value="">No owner</option>
              {admins.length > 0 && (
                <optgroup label="Administrators">
                  {admins.map((i) => (
                    <option key={i.email} value={i.email}>
                      {i.fullName || i.email}
                    </option>
                  ))}
                </optgroup>
              )}
              {judges.length > 0 && (
                <optgroup label="Guest judges">
                  {judges.map((i) => (
                    <option key={i.email} value={i.email}>
                      {i.fullName || i.email}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            <Button type="submit" variant="brand" disabled={adding || !name.trim() || (items?.length ?? 0) >= CHECKLIST_LIMITS.itemsPerDay}>
              {adding && <Loader2 className="animate-spin" />}
              Add
            </Button>
          </form>
        )}

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
