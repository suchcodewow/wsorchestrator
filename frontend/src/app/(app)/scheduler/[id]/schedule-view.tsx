"use client";

/**
 * A bootcamp's schedule, as a manager rearranges it. Three views: a day of
 * all four tracks in detail, the same with names only, and one track across
 * every day. A session is dragged to any time of any column — another track
 * of the day, or in one track's view another day — and what it lands on is
 * pushed later. Moves and length changes are saved a moment after the last
 * one, a track-day at a time; what clashes is worked out here as things move.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
} from "@dnd-kit/core";
import { AlertTriangle, CalendarDays, Check, ChevronLeft, ChevronRight, Copy, Loader2, Rows3, Rows4 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { SCHEDULE_LIMITS, SCHEDULE_TRACKS, type ScheduleTrack } from "@/db/schema";
import { riseChild, staggerParent } from "@/lib/motion";
import type { ChecklistDayCount } from "@/lib/scheduler/checklist";
import type { CopySource, Schedule, SessionRow } from "@/lib/scheduler/schedule";
import type { SessionTypeRow } from "@/lib/scheduler/session-types";
import {
  TRACK_LABELS,
  dayDate,
  describeClash,
  findClashes,
  formatClock,
  place,
  snapStart,
  trackDays,
  type Clash,
  type Placed,
} from "@/lib/scheduler/timeline";
import { cn } from "@/lib/utils";
import { Board, COLUMN_ATTR, SCALE, SessionFace, type BoardColumn, type Density } from "./board";
import { useChecklistButtons } from "./checklist";
import { dayOf, everyDay, keyOf, locate, moveTo, resize, type Days } from "./days";
import { CopyDialog } from "./copy-dialog";
import { SessionDialog, type SessionTarget } from "./session-dialog";

type View = "detailed" | "condensed" | "week";

const VIEWS: { id: View; label: string; icon: typeof Rows3 }[] = [
  { id: "detailed", label: "Detailed", icon: Rows3 },
  { id: "condensed", label: "Condensed", icon: Rows4 },
  { id: "week", label: "One track", icon: CalendarDays },
];

const SAVE_DELAY = 700;

const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const dateLabel = (iso: string) => WEEKDAY.format(new Date(`${iso}T00:00:00Z`));

type SaveState = { state: "idle" | "waiting" | "saving" } | { state: "error"; message: string };

export function ScheduleView({
  initial,
  types,
  sources,
  canManage,
  viewerId,
  viewerEmail,
  checklist,
}: {
  initial: Schedule;
  types: SessionTypeRow[];
  sources: CopySource[];
  canManage: boolean;
  viewerId: string;
  viewerEmail: string;
  /** How much of each class-day's checklist is done. */
  checklist: ChecklistDayCount[];
}) {
  const router = useRouter();
  const { bootcamp } = initial;
  const [schedule, setSchedule] = useState(initial);
  const [days, setDays] = useState<Days>(initial.days);
  const [view, setView] = useState<View>("detailed");
  const [day, setDay] = useState(1);
  const [track, setTrack] = useState<ScheduleTrack>("btc");
  const [target, setTarget] = useState<SessionTarget | null>(null);
  const [filling, setFilling] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [save, setSave] = useState<SaveState>({ state: "idle" });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [resizingId, setResizingId] = useState<string | null>(null);
  const [showIssues, setShowIssues] = useState(false);
  const checklistButton = useChecklistButtons({
    bootcampId: bootcamp.id,
    counts: checklist,
    canManage,
    viewerEmail,
    instructors: schedule.instructors,
  });

  const tracks = SCHEDULE_TRACKS.filter((t) => (trackDays(t, bootcamp) ?? 0) > 0);
  const dayCount = Math.max(bootcamp.btcDays, bootcamp.intDays ?? 0);

  // ── Saving ──────────────────────────────────────────────────────────────
  const daysRef = useRef(days);
  useEffect(() => {
    daysRef.current = days;
  }, [days]);
  const dirty = useRef(new Set<string>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef<Promise<void> | null>(null);

  const reload = useCallback(async () => {
    const res = await fetch(`/api/scheduler/bootcamps/${bootcamp.id}/schedule`, { cache: "no-store" }).catch(() => null);
    if (!res?.ok) return setNotice("Could not reload the schedule — refresh the page.");
    const next = (await res.json()) as Schedule;
    setSchedule(next);
    setDays(next.days);
    router.refresh();
  }, [bootcamp.id, router]);

  /** Saves every track-day changed so far, after any save already under way. True when nothing is left unsaved. */
  const flush = useCallback(async (): Promise<boolean> => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    while (inflight.current) await inflight.current;
    if (dirty.current.size === 0) return true;

    const keys = [...dirty.current];
    dirty.current.clear();
    const body = {
      days: keys.map((key) => {
        const [t, d] = key.split(":");
        return {
          track: t,
          day: Number(d),
          sessions: dayOf(daysRef.current, key).map((s) => ({ id: s.id, start: s.start, minutes: s.minutes })),
        };
      }),
    };
    setSave({ state: "saving" });
    let ok = false;
    const run = (async () => {
      try {
        const res = await fetch(`/api/scheduler/bootcamps/${bootcamp.id}/schedule/layout`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const out = await res.json().catch(() => null);
        if (res.ok) {
          ok = true;
          setSave(dirty.current.size > 0 ? { state: "waiting" } : { state: "idle" });
        } else if (out?.error === "stale") {
          setSave({ state: "idle" });
          setNotice("Someone else changed this schedule at the same time. It now shows the saved version — make your change again.");
          await reload();
        } else {
          keys.forEach((k) => dirty.current.add(k));
          setSave({ state: "error", message: out?.error === "forbidden" ? "Your role changed — reload the page." : `Could not save (${res.status}).` });
        }
      } catch {
        keys.forEach((k) => dirty.current.add(k));
        setSave({ state: "error", message: "Could not reach the server." });
      }
    })();
    inflight.current = run;
    await run;
    inflight.current = null;
    return ok && dirty.current.size === 0;
  }, [bootcamp.id, reload]);

  const touch = useCallback(
    (keys: string[]) => {
      keys.forEach((k) => dirty.current.add(k));
      setSave({ state: "waiting" });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), SAVE_DELAY);
    },
    [flush],
  );

  useEffect(() => {
    if (save.state === "idle") return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [save.state]);

  // ── What clashes ────────────────────────────────────────────────────────
  const placed = useMemo(() => place(everyDay(days)), [days]);
  const clashes = useMemo(() => findClashes(placed), [placed]);
  const roomNames = useMemo(() => new Map(schedule.rooms.map((r) => [r.id, r.name])), [schedule.rooms]);
  const sessionCount = placed.length;
  const { issues, flagged } = useMemo(() => findIssues(placed, clashes, roomNames), [placed, clashes, roomNames]);

  // ── The columns on show ─────────────────────────────────────────────────
  const shownTrack = tracks.includes(track) ? track : tracks[0]!;
  const columns: BoardColumn[] =
    view === "week"
      ? Array.from({ length: trackDays(shownTrack, bootcamp) ?? 0 }, (_, i) => ({
          key: keyOf(shownTrack, i + 1),
          track: shownTrack,
          day: i + 1,
          title: `Day ${i + 1}`,
          subtitle: dateLabel(dayDate(bootcamp.startDate, i + 1)),
          sessions: days[shownTrack][i] ?? [],
        }))
      : tracks
          .filter((t) => (trackDays(t, bootcamp) ?? 0) >= day)
          .map((t) => ({
            key: keyOf(t, day),
            track: t,
            day,
            title: TRACK_LABELS[t],
            subtitle: `Day ${day}`,
            sessions: days[t][day - 1] ?? [],
          }));
  const boardDensity: Density = view === "condensed" ? "condensed" : "detailed";

  // ── Dragging ────────────────────────────────────────────────────────────
  const scale = SCALE[boardDensity];
  // An arrow key moves a dragged card a quarter hour, or a column across.
  const keyboardCoordinates: KeyboardCoordinateGetter = (event, { currentCoordinates: at }) => {
    const across = document.querySelector(`[${COLUMN_ATTR}]`)?.getBoundingClientRect().width ?? 192;
    const by = SCHEDULE_LIMITS.slot * scale;
    if (event.code === "ArrowDown") return { ...at, y: at.y + by };
    if (event.code === "ArrowUp") return { ...at, y: at.y - by };
    if (event.code === "ArrowRight") return { ...at, x: at.x + across };
    if (event.code === "ArrowLeft") return { ...at, x: at.x - across };
    return undefined;
  };
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: keyboardCoordinates,
      keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space", "Enter"] },
    }),
  );
  /** Where the dragged session started, and the schedule before it moved: each preview is worked out from this. */
  const origin = useRef<{ key: string; start: number; days: Days } | null>(null);
  const dropping = useRef<string | null>(null);
  const droppedAt = useRef(0);

  /** The column under the dragged card and the time its top edge is at, on the quarter hour. */
  const dropPoint = ({ active, over }: DragMoveEvent | DragEndEvent): { key: string; start: number } | null => {
    const rect = active.rect.current.translated;
    if (!over || !rect || !String(over.id).startsWith("col:")) return null;
    const key = String(over.id).slice(4);
    const column = document.querySelector(`[${COLUMN_ATTR}="${key}"]`);
    const session = origin.current && dayOf(origin.current.days, locate(origin.current.days, String(active.id))?.key ?? "");
    const minutes = session?.find((s) => s.id === active.id)?.minutes ?? SCHEDULE_LIMITS.slot;
    if (!column) return null;
    return { key, start: snapStart(SCHEDULE_LIMITS.dayStart + (rect.top - column.getBoundingClientRect().top) / scale, minutes) };
  };

  const onDragStart = ({ active }: DragStartEvent) => {
    const at = locate(days, String(active.id));
    if (!at) return;
    origin.current = { key: at.key, start: dayOf(days, at.key)[at.index]!.start, days };
    dropping.current = null;
    setActiveId(String(active.id));
  };

  const onDragMove = (event: DragMoveEvent) => {
    const from = origin.current;
    const point = dropPoint(event);
    if (!from || !point) return;
    const at = `${point.key}@${point.start}`;
    if (at === dropping.current) return;
    dropping.current = at;
    setDays(moveTo(from.days, String(event.active.id), point.key, point.start));
  };

  const onDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    droppedAt.current = Date.now();
    const from = origin.current;
    origin.current = null;
    if (!from) return;
    const point = dropPoint(event);
    // Let go outside every column: it goes back where it was.
    if (!point) return setDays(from.days);
    const next = moveTo(from.days, String(event.active.id), point.key, point.start);
    setDays(next);
    const end = locate(next, String(event.active.id));
    if (!end) return;
    const moved = end.key !== from.key || dayOf(next, end.key)[end.index]!.start !== from.start;
    if (moved) touch([from.key, end.key]);
  };

  const onDragCancel = () => {
    if (origin.current) setDays(origin.current.days);
    origin.current = null;
    setActiveId(null);
  };

  const active = activeId ? placed.find((s) => s.id === activeId) : undefined;

  // ── Resizing ────────────────────────────────────────────────────────────
  /** The schedule as the resize began: each step is worked out from it, so what was pushed comes back as it shrinks. */
  const resizeFrom = useRef<{ minutes: number; days: Days } | null>(null);
  const onResize = (id: string, minutes: number) => {
    if (resizingId !== id || !resizeFrom.current) {
      const at = locate(days, id);
      if (!at) return;
      resizeFrom.current = { minutes: dayOf(days, at.key)[at.index]!.minutes, days };
      setResizingId(id);
    }
    setDays(resize(resizeFrom.current.days, id, minutes));
  };
  const onResizeEnd = (id: string) => {
    setResizingId(null);
    droppedAt.current = Date.now();
    const from = resizeFrom.current;
    resizeFrom.current = null;
    const at = locate(days, id);
    if (!at || !from || from.minutes === dayOf(days, at.key)[at.index]!.minutes) return;
    touch([at.key]);
  };

  const open = (session: SessionRow) => {
    // The click that ends a drag or a resize is not a request to open the card.
    if (Date.now() - droppedAt.current < 250) return;
    setTarget({ mode: "edit", session });
  };

  const afterChange = async () => {
    await reload();
  };

  return (
    <motion.div variants={staggerParent(0.05)} initial="hidden" animate="show" className="space-y-4">
      <motion.div variants={riseChild} className="flex flex-wrap items-center justify-between gap-3 select-none">
        <div className="flex flex-wrap items-center gap-3">
          <div role="tablist" aria-label="View" className="inline-flex rounded-lg border bg-card p-0.5 shadow-xs">
            {VIEWS.map((v) => (
              <button
                key={v.id}
                role="tab"
                aria-selected={view === v.id}
                onClick={() => setView(v.id)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors",
                  view === v.id ? "bg-brand/10 font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <v.icon className="size-3.5" />
                {v.label}
              </button>
            ))}
          </div>

          {view === "week" ? (
            <div role="radiogroup" aria-label="Track" className="flex flex-wrap gap-1">
              {tracks.map((t) => (
                <button
                  key={t}
                  role="radio"
                  aria-checked={shownTrack === t}
                  onClick={() => setTrack(t)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-sm transition-colors",
                    shownTrack === t ? "border-brand-border bg-brand/8 font-medium" : "text-muted-foreground hover:bg-accent",
                  )}
                >
                  {TRACK_LABELS[t]}
                </button>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" className="size-8" aria-label="Previous day" disabled={day <= 1} onClick={() => setDay(day - 1)}>
                <ChevronLeft className="size-4" />
              </Button>
              <div className="min-w-36 text-center text-sm">
                <span className="font-medium">Day {day}</span>
                <span className="text-muted-foreground"> · {dateLabel(dayDate(bootcamp.startDate, day))}</span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label="Next day"
                disabled={day >= dayCount}
                onClick={() => setDay(day + 1)}
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3 text-sm">
          {issues.length > 0 && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setShowIssues(!showIssues)}
                    aria-expanded={showIssues}
                    aria-label={`${issues.length} issue${issues.length === 1 ? "" : "s"}`}
                    className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-1 font-medium text-red-700 tabular-nums hover:bg-red-500/15 dark:text-red-400"
                  >
                    <AlertTriangle className="size-4" />
                    {issues.length}
                  </button>
                </TooltipTrigger>
                <TooltipContent align="end" className="max-w-md">
                  <div className="mb-1.5 border-b pb-1.5 font-medium text-red-700 dark:text-red-400">{tally(issues)}</div>
                  <ul className="space-y-1">
                    {issues.slice(0, ISSUES_IN_TOOLTIP).map((i) => (
                      <li key={i.key}>
                        <span className="font-medium">{i.lead}</span> {i.spots.map(describeClash).join(" and ")}
                      </li>
                    ))}
                  </ul>
                  {issues.length > ISSUES_IN_TOOLTIP && (
                    <div className="mt-1.5 text-muted-foreground">{issues.length - ISSUES_IN_TOOLTIP} more; click to list them all</div>
                  )}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {canManage && <SaveBadge save={save} onRetry={() => void flush()} />}
          {canManage && sources.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => setFilling(true)}>
              <Copy />
              Copy a schedule
            </Button>
          )}
        </div>
      </motion.div>

      {notice && (
        <motion.div variants={riseChild} role="status" className="flex items-start justify-between gap-3 rounded-lg border border-amber-300/60 bg-amber-50 px-4 py-2.5 text-sm dark:border-amber-800/60 dark:bg-amber-950/30">
          <span>{notice}</span>
          <button className="text-muted-foreground hover:text-foreground" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </motion.div>
      )}

      {showIssues && issues.length > 0 && (
        <motion.ul variants={riseChild} className="divide-y rounded-xl border border-red-300/60 bg-red-50/60 text-sm dark:border-red-900/60 dark:bg-red-950/20">
          {issues.map((i) => (
            <li key={i.key} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-4 py-2">
              <span className="font-medium text-red-700 dark:text-red-400">{i.lead}</span>
              {i.spots.map((spot, n) => (
                <span key={spot.sessionId} className="contents">
                  {n > 0 && <span className="text-muted-foreground">and</span>}
                  <button className="underline-offset-2 hover:underline" onClick={() => jump(spot)}>
                    {describeClash(spot)}
                  </button>
                </span>
              ))}
            </li>
          ))}
        </motion.ul>
      )}

      {sessionCount === 0 && canManage && sources.length > 0 && (
        <motion.div variants={riseChild} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed px-5 py-4">
          <p className="text-sm text-muted-foreground">
            {`${sources.length} earlier bootcamp${sources.length === 1 ? " has a schedule" : "s have schedules"} to start from.`}
          </p>
          <Button variant="brand" onClick={() => setFilling(true)}>
            <Copy />
            Copy a schedule
          </Button>
        </motion.div>
      )}

      <motion.div variants={riseChild}>
        {columns.length === 0 ? (
          <p className="rounded-xl border px-5 py-8 text-center text-sm text-muted-foreground">No track runs on day {day}.</p>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={underPointer}
            onDragStart={onDragStart}
            onDragMove={onDragMove}
            onDragEnd={onDragEnd}
            onDragCancel={onDragCancel}
          >
            <Board
              columns={columns}
              density={boardDensity}
              issues={flagged}
              roomNames={roomNames}
              canManage={canManage}
              resizingId={resizingId}
              onOpen={open}
              onAdd={(c, start) => setTarget({ mode: "new", track: c.track, day: c.day, start })}
              onResize={onResize}
              onResizeEnd={onResizeEnd}
              headerAction={checklistButton}
            />
            <DragOverlay dropAnimation={null}>
              {active && (
                <div className="px-1.5" style={{ height: active.minutes * SCALE[boardDensity] }}>
                  <SessionFace
                    session={active}
                    start={active.start}
                    scale={SCALE[boardDensity]}
                    density={boardDensity}
                    issues={flagged}
                    roomNames={roomNames}
                    canManage={false}
                    resizingId={null}
                    onOpen={() => {}}
                    onResize={() => {}}
                    onResizeEnd={() => {}}
                    lifted
                  />
                </div>
              )}
            </DragOverlay>
          </DndContext>
        )}
      </motion.div>

      <SessionDialog
        target={target}
        onClose={() => setTarget(null)}
        bootcampId={bootcamp.id}
        startDate={bootcamp.startDate}
        days={days}
        placed={placed}
        rooms={schedule.rooms}
        hasFacility={Boolean(bootcamp.facilityId)}
        instructors={schedule.instructors}
        types={types}
        canManage={canManage}
        viewerId={viewerId}
        flush={flush}
        onChanged={afterChange}
      />
      {canManage && (
        <CopyDialog
          open={filling}
          onClose={() => setFilling(false)}
          bootcampId={bootcamp.id}
          sessionCount={sessionCount}
          sources={sources}
          flush={flush}
          onDone={afterChange}
        />
      )}
    </motion.div>
  );

  /** Shows the day a session with an issue is on, and opens it. */
  function jump(c: Spot) {
    if (view === "week") setTrack(c.track);
    else setDay(c.day);
    const at = locate(days, c.sessionId);
    const session = at ? dayOf(days, at.key)[at.index] : undefined;
    if (session) setTarget({ mode: "edit", session });
  }
}

/** The column under the pointer; for a card moved by keyboard, the one it overlaps most. */
const underPointer: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length > 0 ? hits : rectIntersection(args);
};

/** Where a session is, for naming it and going to it. */
type Spot = Omit<Clash, "what">;

/** Something wrong with the schedule: a sentence that starts with `lead` and names the sessions it is about. */
type Issue = { kind: IssueKind; key: string; lead: string; spots: Spot[] };

type IssueKind = "clash" | "leader" | "late";

/** How many of each kind there are, for the top of the tooltip: "3 clashes · 12 with nobody leading". */
function tally(issues: Issue[]): string {
  const count = (k: IssueKind) => issues.filter((i) => i.kind === k).length;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const clashes = count("clash");
  const leaders = count("leader");
  const late = count("late");
  return [
    clashes > 0 && plural(clashes, "clash", "clashes"),
    leaders > 0 && `${leaders} with nobody leading`,
    late > 0 && `${late} ending after ${formatClock(SCHEDULE_LIMITS.dayEnd)}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

const ISSUES_IN_TOOLTIP = 8;

/**
 * Everything wrong with the schedule, in the order it happens: each pair of
 * sessions that clash (once), each main or breakout session nobody leads, and
 * each session that ends after the day does. `flagged` has what is wrong with
 * each session, by id, for its card.
 */
function findIssues(placed: Placed<SessionRow>[], clashes: Map<string, Clash[]>, roomNames: Map<string, string>) {
  const { dayEnd } = SCHEDULE_LIMITS;
  const spotOf = (s: Placed<SessionRow>): Spot => ({ sessionId: s.id, name: s.name, track: s.track, day: s.day, start: s.start, end: s.end });
  const nameOf = (what: Clash["what"]) => (what.kind === "person" ? what.fullName : (roomNames.get(what.roomId) ?? "A room"));
  const issues: Issue[] = [];
  const flagged = new Map<string, string[]>();
  const flag = (id: string, why: string) => flagged.set(id, [...(flagged.get(id) ?? []), why]);

  for (const s of placed) {
    for (const c of clashes.get(s.id) ?? []) {
      flag(s.id, `${nameOf(c.what)} is also in ${c.name}`);
      if (s.id > c.sessionId) continue;
      const whatKey = c.what.kind === "person" ? c.what.email : c.what.roomId;
      issues.push({ kind: "clash", key: `clash:${s.id}:${c.sessionId}:${whatKey}`, lead: `${nameOf(c.what)} is in both`, spots: [spotOf(s), c] });
    }
    if (s.kind !== "unstructured" && s.staff.length === 0) {
      flag(s.id, "Nobody leads it");
      issues.push({ kind: "leader", key: `leader:${s.id}`, lead: "Nobody leads", spots: [spotOf(s)] });
    }
    if (s.end > dayEnd) {
      flag(s.id, `Ends after ${formatClock(dayEnd)}`);
      issues.push({ kind: "late", key: `late:${s.id}`, lead: `Ends after ${formatClock(dayEnd)}:`, spots: [spotOf(s)] });
    }
  }
  const first = (i: Issue) => i.spots[0]!;
  issues.sort((x, y) => first(x).day - first(y).day || first(x).start - first(y).start);
  return { issues, flagged };
}

function SaveBadge({ save, onRetry }: { save: SaveState; onRetry: () => void }) {
  if (save.state === "error") {
    return (
      <span className="inline-flex items-center gap-1.5 text-destructive">
        {save.message}
        <button className="font-medium underline underline-offset-2" onClick={onRetry}>
          Try again
        </button>
      </span>
    );
  }
  if (save.state === "idle") {
    return (
      <span className="inline-flex items-center gap-1 text-muted-foreground">
        <Check className="size-3.5" />
        Saved
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-muted-foreground">
      <Loader2 className="size-3.5 animate-spin" />
      Saving
    </span>
  );
}
