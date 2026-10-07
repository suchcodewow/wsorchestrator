"use client";

/**
 * What has to be done before each half of each day of a track: atop each day
 * of the schedule, a sunrise button for the morning's and a sunset button for
 * the afternoon's, each showing how much of it is ticked. Prep Day's sit in
 * the board's corner, stacked. Any of them opens the track's checklists as a
 * board, a column a day with AM above PM, and briefly lights the half that
 * was clicked.
 *
 * A Training administrator adds cards, edits, ticks and removes them, drags
 * them to another half-day, and copies them: the copy button on a card
 * duplicates it in place, or, dragged, drops a duplicate wherever it is let
 * go. An item's owner ticks their own.
 */

import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, MotionConfig, motion, type MotionProps } from "framer-motion";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { Check, Copy, Loader2, Plus, Sunrise, Sunset, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MentionText } from "@/components/mention-text";
import { MentionTextarea } from "@/components/mention-textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  CHECKLIST_LIMITS,
  CHECKLIST_PERIODS,
  CHECKLIST_PREP_DAY,
  SCHEDULE_TRACKS,
  type ChecklistPeriod,
  type ChecklistTrack,
} from "@/db/schema";
import { mentionsIn, type MentionPick } from "@/lib/mentions";
import type { ChecklistDayCount, ChecklistItemRow } from "@/lib/scheduler/checklist";
import type { Instructor } from "@/lib/scheduler/schedule";
import { TRACK_LABELS, checklistDayLabel, dayDate, trackDays } from "@/lib/scheduler/timeline";
import { cn } from "@/lib/utils";
import { formatWhen } from "../../cohort-settings/format";
import type { BoardColumn } from "./board";

const ERRORS: Record<string, string> = {
  invalid: "Give the item a name.",
  not_found: "That item or bootcamp was removed — reload the page.",
  no_day: "That day is no longer part of the bootcamp — reload the page.",
  full: `A day holds at most ${CHECKLIST_LIMITS.itemsPerDay} items, AM and PM together.`,
  not_instructor: "That person is no longer an administrator or guest judge here.",
  not_owner: "Only its owner or an administrator can tick that.",
  forbidden: "Your role changed — reload the page.",
};

/** A row as it arrives over JSON, its times as strings. */
type Item = Omit<ChecklistItemRow, "doneAt" | "createdAt"> & { doneAt: string | null; createdAt: string };

type Count = Pick<ChecklistDayCount, "total" | "done">;

type BootcampDays = { startDate: string; btcDays: number; intDays: number | null };

/** What the board opens on: a track, and the half-day to light. */
type Focus = { track: ChecklistTrack; day: number; period: ChecklistPeriod };

const SELECT =
  "h-8 w-full cursor-pointer appearance-none rounded-md border border-input bg-background px-2.5 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30";

const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const dateLabel = (iso: string) => WEEKDAY.format(new Date(`${iso}T00:00:00Z`));

const countKey = (track: ChecklistTrack, day: number, period: ChecklistPeriod) => `${track}:${day}:${period}`;

/** How each half of the day looks: a sunrise over warm morning light, a sunset into a starry dusk. */
const HALVES: Record<
  ChecklistPeriod,
  {
    label: string;
    icon: typeof Sunrise;
    button: string;
    badge: string;
    section: string;
    glow: string;
    /** The colour it lights up in as the board opens on it, as "r, g, b". */
    light: string;
    chip: string;
  }
> = {
  am: {
    label: "AM",
    icon: Sunrise,
    button: "text-amber-600 hover:bg-amber-500/10 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300",
    badge: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
    section:
      "bg-linear-to-b from-amber-100 via-orange-50 to-sky-50 border-amber-200/80 dark:from-amber-500/20 dark:via-orange-500/10 dark:to-sky-500/5 dark:border-amber-500/20",
    glow: "-top-8 -right-6 size-24 bg-amber-300/60 dark:bg-amber-400/25",
    light: "251, 191, 36",
    chip: "bg-amber-400 text-white shadow-sm shadow-amber-500/40",
  },
  pm: {
    label: "PM",
    icon: Sunset,
    button: "text-violet-600 hover:bg-violet-500/10 hover:text-violet-700 dark:text-violet-400 dark:hover:text-violet-300",
    badge: "bg-violet-500/15 text-violet-800 dark:text-violet-300",
    section:
      "bg-linear-to-b from-orange-100 via-violet-200/70 to-indigo-300/70 border-violet-200/80 dark:from-orange-500/10 dark:via-violet-500/15 dark:to-indigo-500/25 dark:border-violet-500/20",
    glow: "-bottom-10 -left-6 size-28 bg-violet-400/40 dark:bg-indigo-400/20",
    light: "139, 92, 246",
    chip: "bg-linear-to-br from-orange-400 to-violet-500 text-white shadow-sm shadow-violet-500/40",
  },
};

/** Where the stars of a PM section twinkle, as a percentage across and down, and how long after the first each starts. */
const STARS = [
  { x: 62, y: 70, delay: 0 },
  { x: 80, y: 82, delay: 0.7 },
  { x: 90, y: 64, delay: 1.4 },
  { x: 72, y: 90, delay: 2.1 },
  { x: 48, y: 86, delay: 1 },
];

/** A card popping into existence: from small and tilted, overshooting a little as it lands. */
const POP = {
  initial: { opacity: 0, scale: 0.3, y: -10, rotate: -6 },
  animate: { opacity: 1, scale: 1, y: 0, rotate: 0 },
  exit: { opacity: 0, scale: 0.6, transition: { duration: 0.15 } },
  transition: { type: "spring", stiffness: 520, damping: 16, mass: 0.7 },
} satisfies MotionProps;

/**
 * The schedule's checklist buttons: `dayButton` is its `headerAction`, atop
 * each day of each track; `prepDayButton` sits in its corner, before Day 1;
 * `board` is the board they open, to render once alongside them.
 */
export function useChecklistButtons({
  bootcampId,
  bootcamp,
  counts,
  canManage,
  viewerEmail,
  instructors,
}: {
  bootcampId: string;
  bootcamp: BootcampDays;
  counts: ChecklistDayCount[];
  canManage: boolean;
  viewerEmail: string;
  instructors: Instructor[];
}): { dayButton: (column: BoardColumn) => ReactNode; prepDayButton: ReactNode; board: ReactNode } {
  const byKey = (list: ChecklistDayCount[]) => new Map(list.map((c) => [countKey(c.track, c.day, c.period), c]));
  const [checks, setChecks] = useState(() => byKey(counts));
  // A refresh of the page, as after copying a schedule, brings counts that replace what was kept here.
  const [seen, setSeen] = useState(counts);
  if (seen !== counts) {
    setSeen(counts);
    setChecks(byKey(counts));
  }
  const [focus, setFocus] = useState<Focus | null>(null);

  const count = (track: ChecklistTrack, day: number, period: ChecklistPeriod): Count =>
    checks.get(countKey(track, day, period)) ?? { total: 0, done: 0 };

  const half = (track: ChecklistTrack, day: number, period: ChecklistPeriod) => (
    <HalfButton
      key={period}
      period={period}
      label={checklistDayLabel(track, day, period)}
      count={count(track, day, period)}
      onClick={() => setFocus({ track, day, period })}
    />
  );

  // AM above PM, in the corner for Prep Day and beside each day's title.
  const halves = (track: ChecklistTrack, day: number) => (
    <div className="flex shrink-0 flex-col gap-1">{CHECKLIST_PERIODS.map((p) => half(track, day, p))}</div>
  );

  const { track: prepTrack, day: prepDay } = CHECKLIST_PREP_DAY;
  return {
    dayButton: (column) => halves(column.track, column.day),
    prepDayButton: halves(prepTrack, prepDay),
    board: focus && (
      <ChecklistBoard
        key={`${focus.track}:${focus.day}:${focus.period}`}
        focus={focus}
        onClose={() => setFocus(null)}
        bootcampId={bootcampId}
        bootcamp={bootcamp}
        canManage={canManage}
        viewerEmail={viewerEmail}
        instructors={instructors}
        onCounts={(list) =>
          setChecks((prev) => {
            const next = new Map(prev);
            for (const c of list) next.set(countKey(c.track, c.day, c.period), c);
            return next;
          })
        }
      />
    ),
  };
}

function HalfButton({
  period,
  label,
  count,
  onClick,
}: {
  period: ChecklistPeriod;
  /** "Bootcamp, Day 2 AM", for the button's name. */
  label: string;
  count: Count;
  onClick: () => void;
}) {
  const look = HALVES[period];
  const Icon = look.icon;
  const allDone = count.total > 0 && count.done === count.total;
  return (
    <Button
      variant="outline"
      size="sm"
      className={cn(
        "h-6 shrink-0 justify-start gap-1 px-1 text-xs has-[>svg]:px-1",
        allDone ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-400" : look.button,
      )}
      aria-label={`${label}: ${count.done} of ${count.total} done`}
      title={label}
      onClick={onClick}
    >
      <Icon className="size-3.5" />
      {count.total > 0 && (
        <span
          className={cn(
            "rounded-full px-1 py-px text-[11px] font-medium tabular-nums",
            allDone ? "bg-emerald-500/15" : look.badge,
          )}
        >
          {count.done}/{count.total}
        </span>
      )}
    </Button>
  );
}

// ─── The board ──────────────────────────────────────────────────────────────

/** A track's days on the board: Prep Day first on Bootcamp. */
function boardDays(track: ChecklistTrack, bootcamp: Omit<BootcampDays, "startDate">): number[] {
  const days = Array.from({ length: trackDays(track, bootcamp) ?? 0 }, (_, i) => i + 1);
  return track === CHECKLIST_PREP_DAY.track ? [CHECKLIST_PREP_DAY.day, ...days] : days;
}

const sectionKey = (day: number, period: ChecklistPeriod) => `${day}:${period}`;

/** Oldest first, as the API lists them. */
const byAge = (a: Item, b: Item) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);

/** One track's items, loaded together so they never belong to another. */
type Loaded = { track: ChecklistTrack; items: Item[] };

/** What a card is being dragged to do: go somewhere else, or leave a duplicate there. */
type Drag = { kind: "move" | "copy"; item: Item };

function ChecklistBoard({
  focus,
  onClose,
  bootcampId,
  bootcamp,
  canManage,
  viewerEmail,
  instructors,
  onCounts,
}: {
  focus: Focus;
  onClose: () => void;
  bootcampId: string;
  bootcamp: BootcampDays;
  canManage: boolean;
  viewerEmail: string;
  instructors: Instructor[];
  onCounts: (counts: ChecklistDayCount[]) => void;
}) {
  const base = `/api/scheduler/bootcamps/${bootcampId}/checklist`;
  const { btcDays, intDays } = bootcamp;
  const tracks = SCHEDULE_TRACKS.filter((t) => (trackDays(t, bootcamp) ?? 0) > 0);
  const [track, setTrack] = useState(focus.track);
  const days = boardDays(track, bootcamp);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const items = loaded?.track === track ? loaded.items : null;
  const [error, setError] = useState<string | null>(null);
  /** A card being changed, by id, or a section's new card, as "new:{day}:{period}". */
  const [editing, setEditing] = useState<string | null>(null);
  /** The section lit as the board opens. */
  const [lit, setLit] = useState<string | null>(null);
  /** Cards just added, which pop with a burst. */
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [drag, setDrag] = useState<Drag | null>(null);
  const droppedAt = useRef(0);
  const sections = useRef(new Map<string, HTMLElement>());
  const focused = useRef(false);

  // Counts for every half of every day of the track, those with nothing in them included.
  const report = useEffectEvent((l: Loaded) => {
    onCounts(
      boardDays(l.track, bootcamp).flatMap((day) =>
        CHECKLIST_PERIODS.map((period) => {
          const here = l.items.filter((i) => i.day === day && i.period === period);
          return { track: l.track, day, period, total: here.length, done: here.filter((i) => i.done).length };
        }),
      ),
    );
  });
  useEffect(() => {
    if (loaded) report(loaded);
  }, [loaded]);

  // Each day is read whole, at most `itemsPerDay` items; a track is read a day at a time, all at once.
  useEffect(() => {
    let live = true;
    void (async () => {
      const results = await Promise.all(
        boardDays(track, { btcDays, intDays }).map(async (day) => {
          const res = await fetch(`${base}/${track}/${day}`, { cache: "no-store" }).catch(() => null);
          const out = await res?.json().catch(() => null);
          return res?.ok ? (out.items as Item[]) : { error: (out?.error as string | undefined) ?? "" };
        }),
      );
      if (!live) return;
      const failed = results.find((r) => !Array.isArray(r));
      if (failed && !Array.isArray(failed)) return setError(ERRORS[failed.error] ?? "Could not load the checklists.");
      setLoaded({ track, items: (results as Item[][]).flat().sort(byAge) });
    })();
    return () => {
      live = false;
    };
  }, [base, track, btcDays, intDays]);

  // Once the board's first track is in, the half that was clicked scrolls into view and lights up briefly.
  useEffect(() => {
    if (!items || focused.current) return;
    focused.current = true;
    const key = sectionKey(focus.day, focus.period);
    sections.current.get(key)?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    const on = setTimeout(() => setLit(key), 150);
    const off = setTimeout(() => setLit(null), 1100);
    return () => {
      clearTimeout(on);
      clearTimeout(off);
    };
  }, [items, focus]);

  const change = (fn: (list: Item[]) => Item[]) =>
    setLoaded((prev) => (prev && prev.track === track ? { track, items: fn(prev.items).sort(byAge) } : prev));
  const put = (item: Item) => change((list) => [...list.filter((i) => i.id !== item.id), item]);
  const pop = (id: string) => {
    setFresh((prev) => new Set(prev).add(id));
    setTimeout(
      () =>
        setFresh((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        }),
      900,
    );
  };

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

  async function add(day: number, period: ChecklistPeriod, fields: ItemFields): Promise<boolean> {
    const out = (await send(`${base}/${track}/${day}`, { method: "POST", body: JSON.stringify({ ...fields, period }) })) as Item | null;
    if (!out) return false;
    pop(out.id);
    put(out);
    return true;
  }

  async function edit(item: Item, fields: ItemFields): Promise<boolean> {
    const out = (await send(`${base}/items/${item.id}`, { method: "PATCH", body: JSON.stringify(fields) })) as Item | null;
    if (!out) return false;
    put(out);
    setEditing(null);
    return true;
  }

  /** Ticked here at once, and put back if the server will not have it. */
  async function tick(item: Item) {
    put({ ...item, done: !item.done, doneAt: item.done ? null : new Date().toISOString(), doneByName: item.done ? "" : "you" });
    const out = (await send(`${base}/items/${item.id}`, { method: "PATCH", body: JSON.stringify({ done: !item.done }) })) as Item | null;
    put(out ?? item);
  }

  async function remove(item: Item) {
    if (!window.confirm(`Delete “${item.name}”?`)) return;
    const out = await send(`${base}/items/${item.id}`, { method: "DELETE" });
    if (!out) return;
    change((list) => list.filter((i) => i.id !== item.id));
    setEditing(null);
  }

  /** Moved here at once, and put back if the server will not have it. */
  async function move(item: Item, day: number, period: ChecklistPeriod) {
    put({ ...item, day, period });
    const out = (await send(`${base}/items/${item.id}`, { method: "PATCH", body: JSON.stringify({ day, period }) })) as Item | null;
    put(out ?? item);
  }

  async function copy(item: Item, day: number, period: ChecklistPeriod) {
    await add(day, period, { name: item.name, ownerEmail: item.ownerEmail, mentions: item.mentions.map((m) => m.email) });
  }

  // ── Dragging ──────────────────────────────────────────────────────────────
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space", "Enter"] } }),
  );
  const onDragStart = ({ active }: DragStartEvent) => setDrag((active.data.current as Drag | undefined) ?? null);
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setDrag(null);
    droppedAt.current = Date.now();
    const what = active.data.current as Drag | undefined;
    const to = over?.data.current as { day: number; period: ChecklistPeriod } | undefined;
    if (!what || !to) return;
    if (what.kind === "copy") return void copy(what.item, to.day, to.period);
    if (what.item.day !== to.day || what.item.period !== to.period) void move(what.item, to.day, to.period);
  };
  /** The click that ends a drag is not a request to open or copy the card. */
  const justDropped = () => Date.now() - droppedAt.current < 250;

  const done = items?.filter((i) => i.done).length ?? 0;
  const dayTotal = (day: number) => items?.filter((i) => i.day === day).length ?? 0;

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        className="flex h-[calc(100dvh-3rem)] max-w-[min(110rem,calc(100vw-2rem))] flex-col gap-3 overflow-hidden p-0"
        onEscapeKeyDown={(e) => {
          // Escape leaves a card being changed as it was, rather than closing the whole board.
          if (editing === null && drag === null) return;
          e.preventDefault();
          if (drag === null) setEditing(null);
        }}
      >
        <DialogHeader className="flex-row flex-wrap items-center gap-x-4 gap-y-2 border-b px-6 pt-5 pb-4 pr-14">
          <div className="min-w-0">
            <DialogTitle>{TRACK_LABELS[track]} checklist</DialogTitle>
            {items && (
              <p className="text-sm text-muted-foreground tabular-nums">
                {items.length === 0 ? "Nothing on it yet" : `${done} of ${items.length} done`}
              </p>
            )}
          </div>
          {tracks.length > 1 && (
            <div role="radiogroup" aria-label="Track" className="flex flex-wrap gap-1 sm:ml-auto">
              {tracks.map((t) => (
                <button
                  key={t}
                  role="radio"
                  aria-checked={track === t}
                  onClick={() => {
                    setEditing(null);
                    setError(null);
                    setTrack(t);
                  }}
                  className={cn(
                    "rounded-full border px-3 py-1 text-sm transition-colors",
                    track === t ? "border-brand-border bg-brand/8 font-medium" : "text-muted-foreground hover:bg-accent",
                  )}
                >
                  {TRACK_LABELS[t]}
                </button>
              ))}
            </div>
          )}
        </DialogHeader>

        {error && (
          <p role="alert" className="mx-6 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        {items === null ? (
          !error && (
            <div className="flex flex-1 items-center justify-center text-muted-foreground">
              <Loader2 className="size-6 animate-spin" />
            </div>
          )
        ) : (
          <MotionConfig reducedMotion="user">
            <DndContext
              id={`checklist-${bootcampId}`}
              sensors={sensors}
              collisionDetection={underPointer}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
              onDragCancel={() => setDrag(null)}
            >
              <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto px-6 pb-6">
                {days.map((day) => {
                  const date = dayDate(bootcamp.startDate, day);
                  const here = items.filter((i) => i.day === day);
                  const full = dayTotal(day) >= CHECKLIST_LIMITS.itemsPerDay;
                  return (
                    <section
                      key={day}
                      aria-label={checklistDayLabel(track, day)}
                      className="relative flex w-72 shrink-0 flex-col gap-2 rounded-2xl border bg-muted/40 p-2"
                    >
                      <div className="flex items-baseline justify-between gap-2 px-1.5 pt-1">
                        <div className="min-w-0 truncate">
                          <span className="font-medium">{day === CHECKLIST_PREP_DAY.day ? "Prep Day" : `Day ${day}`}</span>
                          <span className="text-sm text-muted-foreground">
                            {" · "}
                            {dateLabel(date)}
                          </span>
                        </div>
                        <DayProgress items={here} />
                      </div>
                      {CHECKLIST_PERIODS.map((period) => (
                        <HalfSection
                          key={period}
                          day={day}
                          period={period}
                          items={here.filter((i) => i.period === period)}
                          lit={lit === sectionKey(day, period)}
                          full={full}
                          register={(el) => {
                            if (el) sections.current.set(sectionKey(day, period), el);
                            else sections.current.delete(sectionKey(day, period));
                          }}
                          canManage={canManage}
                          viewerEmail={viewerEmail}
                          instructors={instructors}
                          editing={editing}
                          fresh={fresh}
                          dragging={drag}
                          setEditing={setEditing}
                          justDropped={justDropped}
                          onAdd={(fields) => add(day, period, fields)}
                          onEdit={edit}
                          onTick={(item) => void tick(item)}
                          onRemove={(item) => void remove(item)}
                          onCopy={(item) => void copy(item, item.day, item.period)}
                        />
                      ))}
                    </section>
                  );
                })}
              </div>
              {/* The dialog is translated into place, which would carry a fixed overlay inside it off with it. */}
              {createPortal(
                <DragOverlay dropAnimation={null}>
                  {drag && (
                    <div className="w-68 rotate-2 cursor-grabbing">
                      <CardFace item={drag.item} viewerEmail={viewerEmail} lifted copying={drag.kind === "copy"} />
                    </div>
                  )}
                </DragOverlay>,
                document.body,
              )}
            </DndContext>
          </MotionConfig>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** The section under the pointer; for a card moved by keyboard, the one it overlaps most. */
const underPointer: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length > 0 ? hits : rectIntersection(args);
};

/** How much of a day is ticked, as a thin bar that fills. */
function DayProgress({ items }: { items: Item[] }) {
  if (items.length === 0) return null;
  const done = items.filter((i) => i.done).length;
  return (
    <div className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground tabular-nums" title={`${done} of ${items.length} done`}>
      <div className="h-1.5 w-12 overflow-hidden rounded-full bg-foreground/10">
        <motion.div
          className={cn("h-full rounded-full", done === items.length ? "bg-emerald-500" : "bg-brand")}
          initial={false}
          animate={{ width: `${(done / items.length) * 100}%` }}
          transition={{ type: "spring", stiffness: 200, damping: 26 }}
        />
      </div>
      {done}/{items.length}
    </div>
  );
}

function HalfSection({
  day,
  period,
  items,
  lit,
  full,
  register,
  canManage,
  viewerEmail,
  instructors,
  editing,
  fresh,
  dragging,
  setEditing,
  justDropped,
  onAdd,
  onEdit,
  onTick,
  onRemove,
  onCopy,
}: {
  day: number;
  period: ChecklistPeriod;
  items: Item[];
  lit: boolean;
  /** The day has no room left. */
  full: boolean;
  register: (el: HTMLElement | null) => void;
  canManage: boolean;
  viewerEmail: string;
  instructors: Instructor[];
  editing: string | null;
  fresh: Set<string>;
  dragging: Drag | null;
  setEditing: (id: string | null) => void;
  justDropped: () => boolean;
  onAdd: (fields: ItemFields) => Promise<boolean>;
  onEdit: (item: Item, fields: ItemFields) => Promise<boolean>;
  onTick: (item: Item) => void;
  onRemove: (item: Item) => void;
  onCopy: (item: Item) => void;
}) {
  const look = HALVES[period];
  const Icon = look.icon;
  const { setNodeRef, isOver } = useDroppable({ id: `sec:${sectionKey(day, period)}`, data: { day, period } });
  const composing = editing === `new:${sectionKey(day, period)}`;
  const done = items.filter((i) => i.done).length;
  const list = useRef<HTMLUListElement>(null);

  // A new card is added at the bottom, so the bottom is brought into view as its composer opens.
  useEffect(() => {
    if (composing) list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" });
  }, [composing]);

  // Lit, it pulses once in its own colour and settles; the glow is a shadow, which `overflow-hidden` would clip from anything inside.
  const shine = (ring: number, glow: number, alpha: number) =>
    `0 0 0 ${ring}px rgba(${look.light}, ${alpha}), 0 0 ${glow}px ${glow / 4}px rgba(${look.light}, ${alpha * 0.6})`;
  return (
    <motion.div
      ref={(el) => {
        setNodeRef(el);
        register(el);
      }}
      animate={
        lit
          ? { boxShadow: [shine(0, 0, 0), shine(4, 28, 1), shine(0, 0, 0)], scale: [1, 1.025, 1] }
          : undefined
      }
      transition={{ duration: 0.9, ease: "easeInOut" }}
      className={cn(
        "relative flex min-h-0 flex-1 basis-0 flex-col overflow-hidden rounded-xl border",
        look.section,
        isOver && dragging && "scale-[1.01] outline-2 outline-brand/60",
      )}
    >
      {/* The sun, or the glow it leaves behind, and in the evening a few stars. */}
      <div aria-hidden className={cn("pointer-events-none absolute rounded-full blur-2xl", look.glow)} />
      {period === "pm" &&
        STARS.map((s, n) => (
          <motion.span
            key={n}
            aria-hidden
            className="pointer-events-none absolute size-1 rounded-full bg-white shadow-[0_0_4px_white] dark:bg-violet-100"
            style={{ left: `${s.x}%`, top: `${s.y}%` }}
            animate={{ opacity: [0.15, 0.9, 0.15], scale: [0.8, 1.2, 0.8] }}
            transition={{ duration: 2.8, repeat: Infinity, delay: s.delay, ease: "easeInOut" }}
          />
        ))}

      <div className="relative flex items-center gap-2 px-2.5 pt-2 pb-1.5">
        <span className={cn("flex size-6 items-center justify-center rounded-full", look.chip)}>
          <Icon className="size-3.5" />
        </span>
        <span className="text-sm font-semibold tracking-wide">{look.label}</span>
        {items.length > 0 && (
          <span className={cn("rounded-full px-1.5 py-px text-[11px] font-medium tabular-nums", look.badge)}>
            {done}/{items.length}
          </span>
        )}
      </div>

      <ul ref={list} className="relative flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-2 pb-2">
        <AnimatePresence initial={false}>
          {items.map((item) =>
            editing === item.id ? (
              <motion.li key={`edit:${item.id}`} layout {...POP}>
                <div className="rounded-lg border bg-card p-2 shadow-md">
                  <ItemForm
                    instructors={instructors}
                    initial={{ name: item.name, picks: item.mentions, owner: item.ownerEmail ?? "" }}
                    submitLabel="Save"
                    onSubmit={(fields) => onEdit(item, fields)}
                    onCancel={() => setEditing(null)}
                    onDelete={() => onRemove(item)}
                  />
                </div>
              </motion.li>
            ) : (
              <ChecklistCard
                key={item.id}
                item={item}
                canManage={canManage}
                viewerEmail={viewerEmail}
                fresh={fresh.has(item.id)}
                moving={dragging?.kind === "move" && dragging.item.id === item.id}
                onOpen={() => !justDropped() && setEditing(item.id)}
                onTick={() => onTick(item)}
                onCopy={() => !justDropped() && onCopy(item)}
              />
            ),
          )}
          {composing && (
            <motion.li key="new" layout {...POP} className="relative">
              <Burst />
              <div className="rounded-lg border bg-card p-2 shadow-md">
                <ItemForm
                  instructors={instructors}
                  initial={{ name: "", picks: [], owner: "" }}
                  submitLabel="Add"
                  full={full}
                  autoFocus
                  onSubmit={onAdd}
                  onCancel={() => setEditing(null)}
                />
              </div>
            </motion.li>
          )}
        </AnimatePresence>
        {canManage && !composing && (
          <li>
            <motion.button
              type="button"
              whileHover="hover"
              whileTap={{ scale: 0.97 }}
              disabled={full}
              onClick={() => setEditing(`new:${sectionKey(day, period)}`)}
              aria-label={`Add to ${look.label}`}
              title={full ? `A day holds at most ${CHECKLIST_LIMITS.itemsPerDay} items` : `Add to ${look.label}`}
              className="flex h-9 w-full items-center justify-center rounded-lg border border-dashed border-foreground/25 bg-background/30 text-foreground/50 transition-colors hover:border-foreground/45 hover:bg-background/60 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
            >
              <motion.span variants={{ hover: { scale: 1.12, rotate: 90 } }} transition={{ type: "spring", stiffness: 500, damping: 18 }}>
                <Plus className="size-4" />
              </motion.span>
            </motion.button>
          </li>
        )}
        {!canManage && items.length === 0 && (
          <li className="flex flex-1 items-center justify-center py-3 text-xs text-foreground/40">Nothing yet</li>
        )}
      </ul>
    </motion.div>
  );
}

/** A few sparks flying out from where a card popped in. */
function Burst() {
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
      {Array.from({ length: 8 }, (_, n) => {
        const angle = (n / 8) * Math.PI * 2;
        return (
          <motion.span
            key={n}
            className={cn("absolute size-1.5 rounded-full", n % 2 ? "bg-amber-400" : "bg-brand")}
            initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
            animate={{ x: Math.cos(angle) * 90, y: Math.sin(angle) * 34, opacity: 0, scale: 0.4 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
          />
        );
      })}
    </span>
  );
}

/**
 * A card on the board. Hovering shows what can be done with it: a circle to
 * tick it, and in the bottom-right corner a copy
 * button that duplicates it when clicked, or drops a duplicate wherever it is
 * dragged. A manager drags the card itself to move it, or clicks it to change it.
 */
function ChecklistCard({
  item,
  canManage,
  viewerEmail,
  fresh,
  moving,
  onOpen,
  onTick,
  onCopy,
}: {
  item: Item;
  canManage: boolean;
  viewerEmail: string;
  fresh: boolean;
  /** Being dragged elsewhere: left faint where it was. */
  moving: boolean;
  onOpen: () => void;
  onTick: () => void;
  onCopy: () => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef } = useDraggable({
    id: `move:${item.id}`,
    data: { kind: "move", item } satisfies Drag,
    disabled: !canManage,
  });
  const {
    attributes: copyAttributes,
    listeners: copyListeners,
    setNodeRef: setCopyRef,
  } = useDraggable({ id: `copy:${item.id}`, data: { kind: "copy", item } satisfies Drag, disabled: !canManage });
  const mine = item.ownerEmail !== null && item.ownerEmail === viewerEmail.toLowerCase();
  const canTick = canManage || mine;

  return (
    <motion.li layout {...POP} className="relative">
      {fresh && <Burst />}
      <div
        ref={(el) => {
          setNodeRef(el);
          // So Space on a button inside the card presses it rather than picking the card up.
          setActivatorNodeRef(el);
        }}
        {...(canManage ? { ...attributes, ...listeners } : {})}
        onClick={canManage ? onOpen : undefined}
        onKeyDown={(e) => {
          // Enter changes the card; Space, from dnd-kit, picks it up to move.
          if (canManage && e.key === "Enter" && e.target === e.currentTarget) onOpen();
          else listeners?.onKeyDown?.(e);
        }}
        aria-label={canManage ? `${item.name}: drag to move, click to change` : undefined}
        className={cn("group relative", canManage && "cursor-pointer active:cursor-grabbing", moving && "opacity-40")}
      >
        <CardFace
          item={item}
          viewerEmail={viewerEmail}
          tick={
            canTick ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onTick();
                }}
                aria-label={`${item.done ? "Untick" : "Tick"} ${item.name}`}
                className={cn(
                  "flex size-4 shrink-0 items-center justify-center rounded-full border-2 transition-all",
                  item.done
                    ? "border-emerald-500 bg-emerald-500 text-white"
                    : "-ml-5 border-foreground/30 opacity-0 hover:border-emerald-500 group-focus-within:ml-0 group-focus-within:opacity-100 group-hover:ml-0 group-hover:opacity-100",
                )}
              >
                {item.done && <Check className="size-2.5" strokeWidth={4} />}
              </button>
            ) : (
              item.done && (
                <span
                  className="flex size-4 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white"
                  title="Only its owner or an administrator can tick this"
                >
                  <Check className="size-2.5" strokeWidth={4} />
                </span>
              )
            )
          }
        />
        {canManage && (
          <button
            type="button"
            ref={setCopyRef}
            {...copyAttributes}
            {...copyListeners}
            onClick={(e) => {
              e.stopPropagation();
              onCopy();
            }}
            aria-label={`Copy ${item.name}: click to duplicate it here, or drag to drop a duplicate in another section`}
            title="Click to duplicate, or drag to drop a copy elsewhere"
            className="absolute right-1.5 bottom-1.5 flex size-6 cursor-copy items-center justify-center rounded-md bg-card/90 text-muted-foreground opacity-0 shadow-xs transition-all group-focus-within:opacity-100 group-hover:opacity-100 hover:scale-110 hover:bg-brand/10 hover:text-foreground"
          >
            <Copy className="size-3.5" />
          </button>
        )}
      </div>
    </motion.li>
  );
}

/** What a card shows: its name, whom it is on, and who ticked it. */
function CardFace({
  item,
  viewerEmail,
  tick,
  lifted = false,
  copying = false,
}: {
  item: Item;
  viewerEmail: string;
  tick?: ReactNode;
  /** As it is dragged. */
  lifted?: boolean;
  /** Dragged as a copy, so marked as one. */
  copying?: boolean;
}) {
  const mine = item.ownerEmail !== null && item.ownerEmail === viewerEmail.toLowerCase();
  return (
    <div
      title={`Added by ${item.createdByName || item.createdByEmail || "someone removed"} ${formatWhen(item.createdAt)}`}
      className={cn(
        "relative rounded-lg border bg-card px-2.5 py-2 pr-8 text-left shadow-xs transition-shadow group-hover:shadow-md group-hover:ring-1 group-hover:ring-brand/30",
        item.done && "border-emerald-500/30 bg-emerald-50/70 dark:bg-emerald-950/30",
        lifted && "shadow-xl ring-2 ring-brand/40",
      )}
    >
      {copying && (
        <span className="absolute -top-2 -right-2 flex size-5 items-center justify-center rounded-full bg-brand text-brand-foreground shadow-md">
          <Plus className="size-3.5" />
        </span>
      )}
      <div className="flex items-start gap-1.5">
        {tick && <div className="mt-0.5 flex">{tick}</div>}
        <div className={cn("min-w-0 text-sm wrap-break-word", item.done && "text-muted-foreground line-through")}>
          <MentionText text={item.name} mentions={item.mentions} viewerEmail={viewerEmail} />
        </div>
      </div>
      {(item.ownerEmail || (item.done && item.doneAt)) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          {item.ownerEmail && (
            <span className={cn("inline-flex min-w-0 items-center gap-1", mine && "font-medium text-foreground")}>
              <span
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold",
                  mine ? "bg-brand text-brand-foreground" : "bg-foreground/10",
                )}
              >
                {initials(item.ownerName || item.ownerEmail)}
              </span>
              <span className="truncate">
                {item.ownerName || item.ownerEmail}
                {mine && " (you)"}
              </span>
            </span>
          )}
          {item.done && item.doneAt && (
            <span className="text-emerald-700 dark:text-emerald-400">
              ✓ {item.doneByName || "someone"} {formatWhen(item.doneAt)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** "AR" for Ana Ruiz, "A" for ana@example.com. */
function initials(name: string): string {
  const words = name.split("@")[0]!.split(/[\s._-]+/).filter(Boolean);
  return ((words[0]?.[0] ?? "") + (words.length > 1 ? (words.at(-1)?.[0] ?? "") : "")).toUpperCase() || "?";
}

/** What the API takes to add an item, or to change one. */
type ItemFields = { name: string; ownerEmail: string | null; mentions: string[] };

/**
 * An item's name, with "@" tags, and its owner: blank for adding one, which
 * empties again once added, ready for the next, or holding an item's own to
 * change it.
 */
function ItemForm({
  instructors,
  initial,
  submitLabel,
  full = false,
  autoFocus = false,
  onSubmit,
  onCancel,
  onDelete,
}: {
  instructors: Instructor[];
  initial: { name: string; picks: MentionPick[]; owner: string };
  submitLabel: string;
  full?: boolean;
  autoFocus?: boolean;
  onSubmit: (fields: ItemFields) => Promise<boolean>;
  onCancel: () => void;
  /** Shown when changing an item, to remove it. */
  onDelete?: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [picks, setPicks] = useState<MentionPick[]>(initial.picks);
  const [owner, setOwner] = useState(initial.owner);
  const [pending, setPending] = useState(false);
  const admins = instructors.filter((i) => i.role === "administrator");
  const judges = instructors.filter((i) => i.role === "judge");
  // Someone who owns it but is no longer an administrator or guest judge here stays pickable, as they are.
  const formerOwner = owner && !instructors.some((i) => i.email === owner) ? owner : null;
  const adding = !onDelete;

  async function submit() {
    if (!name.trim() || pending) return;
    setPending(true);
    const ok = await onSubmit({ name, ownerEmail: owner || null, mentions: mentionsIn(name, picks).map((p) => p.email) });
    setPending(false);
    if (ok && adding) {
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
        aria-label={adding ? "New item" : "Item"}
        autoFocus={autoFocus || !adding}
      />
      <select value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Owner" className={SELECT}>
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
      <div className="flex items-center gap-1.5">
        {onDelete && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground hover:text-destructive"
            aria-label="Delete"
            disabled={pending}
            onClick={onDelete}
          >
            <Trash2 className="size-4" />
          </Button>
        )}
        <Button type="button" variant="ghost" size="sm" className="ml-auto" disabled={pending} onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="brand" size="sm" disabled={pending || !name.trim() || full}>
          {pending && <Loader2 className="animate-spin" />}
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
