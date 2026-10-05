"use client";

/**
 * What has to be done before a day of a track starts, each track its own: a
 * button at the top of the day showing how much of it is ticked, opening the
 * list. Prep Day's, for before the bootcamp starts, sits in the board's corner
 * as the icon and its count alone. A Training administrator adds, edits and removes items and ticks any
 * of them; an item's owner ticks their own.
 */

import { useEffect, useEffectEvent, useState, type ReactNode } from "react";
import { ListChecks, Loader2, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MentionText } from "@/components/mention-text";
import { MentionTextarea } from "@/components/mention-textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CHECKLIST_LIMITS, CHECKLIST_PREP_DAY, type ChecklistTrack } from "@/db/schema";
import { mentionsIn, type MentionPick } from "@/lib/mentions";
import type { ChecklistDayCount, ChecklistItemRow } from "@/lib/scheduler/checklist";
import type { Instructor } from "@/lib/scheduler/schedule";
import { checklistDayLabel } from "@/lib/scheduler/timeline";
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
  "h-9 cursor-pointer appearance-none rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30";

/**
 * The board's checklist buttons: `dayButton` is its `headerAction`, atop each
 * day of each track; `prepDayButton` sits in its corner, before Day 1.
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
}): { dayButton: (column: BoardColumn) => ReactNode; prepDayButton: ReactNode } {
  const byKey = (list: ChecklistDayCount[]) => new Map(list.map((c) => [`${c.track}:${c.day}`, c]));
  const [checks, setChecks] = useState(() => byKey(counts));
  // A refresh of the page, as after copying a schedule, brings counts that replace what was kept here.
  const [seen, setSeen] = useState(counts);
  if (seen !== counts) {
    setSeen(counts);
    setChecks(byKey(counts));
  }

  const button = (track: ChecklistTrack, day: number, compact = false) => {
    const key = `${track}:${day}`;
    return (
      <ChecklistButton
        key={key}
        bootcampId={bootcampId}
        track={track}
        day={day}
        label={checklistDayLabel(track, day)}
        compact={compact}
        count={checks.get(key) ?? { total: 0, done: 0 }}
        canManage={canManage}
        viewerEmail={viewerEmail}
        instructors={instructors}
        onCount={(n) => setChecks((prev) => new Map(prev).set(key, { track, day, ...n }))}
      />
    );
  };

  return {
    dayButton: (column) => button(column.track, column.day),
    prepDayButton: button(CHECKLIST_PREP_DAY.track, CHECKLIST_PREP_DAY.day, true),
  };
}

export function ChecklistButton({
  bootcampId,
  track,
  day,
  label,
  compact = false,
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
  /** The icon alone, without the word "Checklist". */
  compact?: boolean;
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
        variant="outline"
        size="sm"
        className={cn(
          "h-7 shrink-0 gap-1.5 px-2 text-xs",
          compact && "gap-1 px-1 has-[>svg]:px-1",
          allDone && "border-emerald-500/50 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-400",
        )}
        aria-label={`Checklist for ${label}: ${count.done} of ${count.total} done`}
        title={compact ? `${label} checklist` : undefined}
        onClick={() => setOpen(true)}
      >
        <ListChecks className="size-3.5" />
        {!compact && "Checklist"}
        {count.total > 0 && (
          <span
            className={cn(
              "rounded-full py-px text-[11px] font-medium tabular-nums",
              compact ? "px-1" : "px-1.5",
              allDone ? "bg-emerald-500/15" : "bg-muted text-muted-foreground",
            )}
          >
            {count.done}/{count.total}
          </span>
        )}
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
  const [busy, setBusy] = useState<string | null>(null);
  /** The item being edited, in place of its row. */
  const [editing, setEditing] = useState<string | null>(null);

  const show = (next: Item[]) => {
    setItems(next);
    onCount({ total: next.length, done: next.filter((i) => i.done).length });
  };

  // `onCount` is the parent's and need not be stable; reporting a load should not refetch.
  const showLoaded = useEffectEvent(show);

  // The dialog is mounted only while open, so this runs once each time it opens.
  useEffect(() => {
    let live = true;
    void (async () => {
      const res = await fetch(`${base}/${track}/${day}`, { cache: "no-store" }).catch(() => null);
      const out = await res?.json().catch(() => null);
      if (!live) return;
      if (!res?.ok) return setError(ERRORS[out?.error ?? ""] ?? "Could not load the checklist.");
      showLoaded(out.items as Item[]);
    })();
    return () => {
      live = false;
    };
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

  async function add(fields: ItemFields): Promise<boolean> {
    const out = await send(`${base}/${track}/${day}`, { method: "POST", body: JSON.stringify(fields) });
    if (!out) return false;
    show([...(items ?? []), out as Item]);
    return true;
  }

  async function edit(item: Item, fields: ItemFields): Promise<boolean> {
    const out = await send(`${base}/items/${item.id}`, { method: "PATCH", body: JSON.stringify(fields) });
    if (!out) return false;
    show((items ?? []).map((i) => (i.id === item.id ? (out as Item) : i)));
    setEditing(null);
    return true;
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

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        className="max-w-xl"
        onEscapeKeyDown={(e) => {
          // Escape leaves an item being changed as it was, rather than closing the whole checklist.
          if (editing === null) return;
          e.preventDefault();
          setEditing(null);
        }}
      >
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
                if (editing === item.id) {
                  return (
                    <li key={item.id} className="px-3 py-2.5">
                      <ItemForm
                        instructors={instructors}
                        initial={{ name: item.name, picks: item.mentions, owner: item.ownerEmail ?? "" }}
                        submitLabel="Save"
                        onSubmit={(fields) => edit(item, fields)}
                        onCancel={() => setEditing(null)}
                      />
                    </li>
                  );
                }
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
                      <div className="flex shrink-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 text-muted-foreground"
                          aria-label={`Edit ${item.name}`}
                          disabled={busy === item.id}
                          onClick={() => setEditing(item.id)}
                        >
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 text-muted-foreground hover:text-destructive"
                          aria-label={`Delete ${item.name}`}
                          disabled={busy === item.id}
                          onClick={() => void remove(item)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )
        )}

        {canManage && items !== null && (
          <ItemForm
            instructors={instructors}
            initial={{ name: "", picks: [], owner: "" }}
            submitLabel="Add"
            full={items.length >= CHECKLIST_LIMITS.itemsPerDay}
            onSubmit={add}
          />
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

/** What the API takes to add an item, or to change one. */
type ItemFields = { name: string; ownerEmail: string | null; mentions: string[] };

/**
 * An item's name, with "@" tags, and its owner: blank for adding one, which
 * empties again once added, or holding an item's own to change it.
 */
function ItemForm({
  instructors,
  initial,
  submitLabel,
  full = false,
  onSubmit,
  onCancel,
}: {
  instructors: Instructor[];
  initial: { name: string; picks: MentionPick[]; owner: string };
  submitLabel: string;
  full?: boolean;
  onSubmit: (fields: ItemFields) => Promise<boolean>;
  /** Shown when changing an item, to leave it as it was. */
  onCancel?: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [picks, setPicks] = useState<MentionPick[]>(initial.picks);
  const [owner, setOwner] = useState(initial.owner);
  const [pending, setPending] = useState(false);
  const admins = instructors.filter((i) => i.role === "administrator");
  const judges = instructors.filter((i) => i.role === "judge");
  // Someone who owns it but is no longer an administrator or guest judge here stays pickable, as they are.
  const formerOwner = owner && !instructors.some((i) => i.email === owner) ? owner : null;

  async function submit() {
    if (!name.trim() || pending) return;
    setPending(true);
    const ok = await onSubmit({ name, ownerEmail: owner || null, mentions: mentionsIn(name, picks).map((p) => p.email) });
    setPending(false);
    if (ok && !onCancel) {
      setName("");
      setPicks([]);
      setOwner("");
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="space-y-2"
    >
      <MentionTextarea
        singleLine
        value={name}
        onChange={setName}
        people={instructors}
        onPick={(p) => setPicks((prev) => [...prev, p])}
        maxLength={CHECKLIST_LIMITS.name}
        placeholder="Add an Item"
        aria-label={onCancel ? "Item" : "New item"}
        autoFocus={Boolean(onCancel)}
      />
      {/* The name across the whole line; who owns it, and the buttons, under it. */}
      <div className="flex items-center gap-2">
        <select value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Owner" className={cn(SELECT, "mr-auto min-w-0")}>
          <option value="">No owner</option>
          {formerOwner && <option value={formerOwner}>{formerOwner}</option>}
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
        {onCancel && (
          <Button type="button" variant="ghost" disabled={pending} onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" variant="brand" disabled={pending || !name.trim() || full}>
          {pending && <Loader2 className="animate-spin" />}
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
