"use client";

/**
 * A bootcamp's schedule, as a manager rearranges it. Three views: a day of
 * all four tracks in detail, the same with names only, and one track across
 * every day. Order and length changes are saved a moment after the last one,
 * a track-day at a time; what clashes is worked out here as things move.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { AlertTriangle, CalendarDays, Check, ChevronLeft, ChevronRight, FileUp, Loader2, Rows3, Rows4, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SCHEDULE_TRACKS, type ScheduleTrack } from "@/db/schema";
import { riseChild, staggerParent } from "@/lib/motion";
import type { CopySource, Schedule, SessionRow } from "@/lib/scheduler/schedule";
import type { SessionTypeRow } from "@/lib/scheduler/session-types";
import {
  TRACK_LABELS,
  dayDate,
  describeClash,
  findClashes,
  place,
  trackDays,
  type Clash,
} from "@/lib/scheduler/timeline";
import { cn } from "@/lib/utils";
import { Board, SCALE, SessionFace, type BoardColumn, type Density } from "./board";
import { dayOf, everyDay, keyOf, locate, moveTo, resize, type Days } from "./days";
import { FillDialog } from "./fill-dialog";
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
}: {
  initial: Schedule;
  types: SessionTypeRow[];
  sources: CopySource[];
  canManage: boolean;
  viewerId: string;
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
  const [showClashes, setShowClashes] = useState(false);

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
        return { track: t, day: Number(d), sessions: dayOf(daysRef.current, key).map((s) => ({ id: s.id, minutes: s.minutes })) };
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
  const leaderless = placed.filter((s) => s.kind !== "unstructured" && s.staff.length === 0).length;
  const pairs = useMemo(() => clashPairs(placed, clashes), [placed, clashes]);

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
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space", "Enter"] },
    }),
  );
  const origin = useRef<{ key: string; index: number; days: Days } | null>(null);
  const droppedAt = useRef(0);

  const containerOf = (id: UniqueIdentifier): string | null => {
    const s = String(id);
    if (s.startsWith("col:")) return s.slice(4);
    return locate(days, s)?.key ?? null;
  };

  const onDragStart = ({ active }: DragStartEvent) => {
    const at = locate(days, String(active.id));
    if (!at) return;
    origin.current = { ...at, days };
    setActiveId(String(active.id));
  };

  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over) return;
    const from = containerOf(active.id);
    const to = containerOf(over.id);
    if (!from || !to || from === to) return;
    const overIndex = dayOf(days, to).findIndex((s) => s.id === over.id);
    const below =
      active.rect.current.translated && active.rect.current.translated.top > over.rect.top + over.rect.height / 2;
    setDays((prev) => moveTo(prev, String(active.id), to, overIndex >= 0 ? overIndex + (below ? 1 : 0) : null));
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveId(null);
    droppedAt.current = Date.now();
    const start = origin.current;
    origin.current = null;
    if (!start) return;
    let next = days;
    if (over) {
      const key = containerOf(active.id);
      const overKey = containerOf(over.id);
      if (key && key === overKey && !String(over.id).startsWith("col:") && over.id !== active.id) {
        const overIndex = dayOf(days, key).findIndex((s) => s.id === over.id);
        next = moveTo(days, String(active.id), key, overIndex);
        setDays(next);
      }
    }
    const end = locate(next, String(active.id));
    if (!end || (end.key === start.key && end.index === start.index)) return;
    touch([start.key, end.key]);
  };

  const onDragCancel = () => {
    if (origin.current) setDays(origin.current.days);
    origin.current = null;
    setActiveId(null);
  };

  const active = activeId ? placed.find((s) => s.id === activeId) : undefined;

  // ── Resizing ────────────────────────────────────────────────────────────
  const resizeFrom = useRef<number | null>(null);
  const onResize = (id: string, minutes: number) => {
    if (resizingId !== id) {
      const at = locate(days, id);
      resizeFrom.current = at ? dayOf(days, at.key)[at.index]!.minutes : null;
      setResizingId(id);
    }
    setDays((prev) => resize(prev, id, minutes));
  };
  const onResizeEnd = (id: string) => {
    setResizingId(null);
    droppedAt.current = Date.now();
    const at = locate(days, id);
    if (!at || resizeFrom.current === dayOf(days, at.key)[at.index]!.minutes) return;
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
      <motion.div variants={riseChild} className="flex flex-wrap items-center justify-between gap-3">
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
          <span className="text-muted-foreground tabular-nums">
            {sessionCount} session{sessionCount === 1 ? "" : "s"}
          </span>
          {leaderless > 0 && (
            <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400" title="Main and breakout sessions with nobody leading them">
              <UserX className="size-3.5" />
              {leaderless} without a leader
            </span>
          )}
          {pairs.length > 0 ? (
            <button
              onClick={() => setShowClashes(!showClashes)}
              aria-expanded={showClashes}
              className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2.5 py-0.5 font-medium text-red-700 hover:bg-red-500/15 dark:text-red-400"
            >
              <AlertTriangle className="size-3.5" />
              {pairs.length} clash{pairs.length === 1 ? "" : "es"}
            </button>
          ) : (
            sessionCount > 0 && <span className="text-muted-foreground">No clashes</span>
          )}
          {canManage && <SaveBadge save={save} onRetry={() => void flush()} />}
          {canManage && (
            <Button variant="outline" size="sm" onClick={() => setFilling(true)}>
              <FileUp />
              Import or copy
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

      {showClashes && pairs.length > 0 && (
        <motion.ul variants={riseChild} className="divide-y rounded-xl border border-red-300/60 bg-red-50/60 text-sm dark:border-red-900/60 dark:bg-red-950/20">
          {pairs.map((p) => (
            <li key={p.key} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-4 py-2">
              <span className="font-medium text-red-700 dark:text-red-400">
                {p.what.kind === "person" ? p.what.fullName : (roomNames.get(p.what.roomId) ?? "A room")}
              </span>
              <span className="text-muted-foreground">is in both</span>
              <button className="underline-offset-2 hover:underline" onClick={() => jump(p.a)}>
                {describeClash(p.a)}
              </button>
              <span className="text-muted-foreground">and</span>
              <button className="underline-offset-2 hover:underline" onClick={() => jump(p.b)}>
                {describeClash(p.b)}
              </button>
            </li>
          ))}
        </motion.ul>
      )}

      {sessionCount === 0 && canManage && (
        <motion.div variants={riseChild} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed px-5 py-4">
          <p className="text-sm text-muted-foreground">
            {sources.length > 0 ? `${sources.length} earlier bootcamp${sources.length === 1 ? " has a schedule" : "s have schedules"} to start from.` : "No sessions yet."}
          </p>
          <Button variant="brand" onClick={() => setFilling(true)}>
            <FileUp />
            Import or copy a schedule
          </Button>
        </motion.div>
      )}

      <motion.div variants={riseChild}>
        {columns.length === 0 ? (
          <p className="rounded-xl border px-5 py-8 text-center text-sm text-muted-foreground">No track runs on day {day}.</p>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDragEnd={onDragEnd}
            onDragCancel={onDragCancel}
          >
            <Board
              columns={columns}
              density={boardDensity}
              clashes={clashes}
              roomNames={roomNames}
              canManage={canManage}
              resizingId={resizingId}
              onOpen={open}
              onAdd={(c) => setTarget({ mode: "new", track: c.track, day: c.day })}
              onResize={onResize}
              onResizeEnd={onResizeEnd}
            />
            <DragOverlay dropAnimation={null}>
              {active && (
                <div className="px-1.5" style={{ height: active.minutes * SCALE[boardDensity] }}>
                  <SessionFace
                    session={active}
                    start={active.start}
                    scale={SCALE[boardDensity]}
                    density={boardDensity}
                    clashes={clashes}
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
        <FillDialog
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

  /** Shows the day a clashing session is on, and opens it. */
  function jump(c: Clash) {
    if (view === "week") setTrack(c.track);
    else setDay(c.day);
    const at = locate(days, c.sessionId);
    const session = at ? dayOf(days, at.key)[at.index] : undefined;
    if (session) setTarget({ mode: "edit", session });
  }
}

/** Each pair of sessions that clash, once, with what they share. */
function clashPairs(placed: ReturnType<typeof place<SessionRow>>, clashes: Map<string, Clash[]>) {
  const byId = new Map(placed.map((s) => [s.id, s]));
  const out: { key: string; a: Clash; b: Clash; what: Clash["what"] }[] = [];
  for (const [id, list] of clashes) {
    const self = byId.get(id);
    if (!self) continue;
    for (const c of list) {
      if (id > c.sessionId) continue;
      const whatKey = c.what.kind === "person" ? c.what.email : c.what.roomId;
      const a: Clash = { sessionId: self.id, name: self.name, track: self.track, day: self.day, start: self.start, end: self.end, what: c.what };
      out.push({ key: `${id}:${c.sessionId}:${whatKey}`, a, b: c, what: c.what });
    }
  }
  return out.sort((x, y) => x.a.day - y.a.day || x.a.start - y.a.start);
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
