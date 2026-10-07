"use client";

/**
 * The schedule drawn to scale: a column per track-day, each session as tall
 * as it is long and placed at its start, from 8 AM. Time nothing is scheduled
 * in shows as Unscheduled; past 5 PM is tinted red. A column whose date is
 * today has a green line across it at the current time, moving as the clock
 * does, in either view. A manager drags a card to
 * any time in any column, drags its bottom edge to change its length a
 * quarter hour at a time, and clicks unscheduled time to add a session there.
 */

import { useRef, useSyncExternalStore, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { AlertTriangle, MessageSquare } from "lucide-react";
import { SCHEDULE_LIMITS, type ScheduleTrack } from "@/db/schema";
import type { SessionRow } from "@/lib/scheduler/schedule";
import { SESSION_STYLES } from "@/lib/scheduler/session-style";
import { dayTotal, formatClock, formatLength, gapsOf, snapMinutes } from "@/lib/scheduler/timeline";
import { cn } from "@/lib/utils";

export type Density = "detailed" | "condensed";

export type BoardColumn = {
  key: string;
  track: ScheduleTrack;
  day: number;
  /** The date it falls on, as "2026-09-14"; on that day the time now is drawn across it. */
  date: string;
  /** "Day 3", leading the header. */
  title: string;
  /** What follows it on the same line: the track, or in one track's view the date. */
  subtitle: string;
  /** Who attends that day, in brackets after the subtitle: "Day 1 · Bootcamp (11)". */
  attendees?: { count: string; noun: string };
  sessions: SessionRow[];
};

/** Pixels per minute in each density: a quarter hour is 28px detailed, 16px condensed. */
export const SCALE: Record<Density, number> = { detailed: 28 / 15, condensed: 16 / 15 };

/** Each column's header, two lines tall, and the gutter's blank corner beside it. */
const HEADER_HEIGHT = "h-17";

const { dayStart, dayEnd } = SCHEDULE_LIMITS;

export type BoardProps = {
  columns: BoardColumn[];
  density: Density;
  /** What is wrong with each session, by id; sessions with nothing wrong are absent. */
  issues: Map<string, string[]>;
  /** Sessions to fade back, by id, so the rest stand out. */
  dimmed?: Set<string>;
  roomNames: Map<string, string>;
  canManage: boolean;
  /** The session being resized, to label its new length as it changes. */
  resizingId: string | null;
  onOpen: (session: SessionRow) => void;
  /** Adds a session to a column at `start`. */
  onAdd: (column: BoardColumn, start: number) => void;
  onResize: (id: string, minutes: number) => void;
  onResizeEnd: (id: string) => void;
  /** Anything more to show at the top of a column, to the right of its title and level with `corner`. */
  headerAction?: (column: BoardColumn) => ReactNode;
  /** Anything to show in the top-left corner, above the hours, level with each column's `headerAction`. */
  corner?: ReactNode;
};

export function Board(props: BoardProps) {
  const { columns, density } = props;
  const scale = SCALE[density];
  const lastEnd = Math.max(dayEnd, ...columns.map((c) => dayTotal(c.sessions).end));
  // An hour of room below the latest session, to drop a card after it.
  const bottom = Math.ceil((lastEnd + 60) / 60) * 60;
  const height = (bottom - dayStart) * scale;
  const hours = Array.from({ length: (bottom - dayStart) / 60 + 1 }, (_, i) => dayStart + i * 60);
  const clock = useClock();
  const today = clock !== null && clock.minute >= dayStart && clock.minute <= bottom ? clock.date : null;
  const now =
    clock !== null && columns.some((c) => c.date === today)
      ? { top: (clock.minute - dayStart) * scale, label: formatClock(Math.floor(clock.minute)).replace(" ", "\u00a0") }
      : null;
  // The line's dot sits at the left end of the first column it crosses.
  const firstToday = columns.findIndex((c) => c.date === today);

  return (
    // `overflow-x-auto` alone makes the board a vertical scroller too; it never scrolls that way, so the wheel moves the page.
    <div className="overflow-x-auto overflow-y-hidden rounded-2xl border bg-card shadow-sm">
      {/* Columns share the width and scroll only below 12rem each; `min-w-fit` would size them to their longest name. */}
      <div className="relative flex" style={{ minWidth: `calc(4rem + ${columns.length} * 12rem)` }}>
        <div className="sticky left-0 z-20 w-16 shrink-0 border-r bg-card">
          <div className={cn(HEADER_HEIGHT, "flex items-end justify-center border-b px-1 pb-2")}>{props.corner}</div>
          <div className="relative" style={{ height }}>
            {hours.map((m) => (
              <div
                key={m}
                className={cn(
                  "absolute right-2 -translate-y-1/2 text-[11px] tabular-nums",
                  m === dayEnd ? "font-medium text-red-600 dark:text-red-400" : "text-muted-foreground",
                )}
                style={{ top: (m - dayStart) * scale }}
              >
                {/* The last line is the board's bottom edge; a label there would hang below it. */}
                {m === dayStart || m === bottom ? "" : formatClock(m).replace(":00", "")}
              </div>
            ))}
            {now !== null && (
              <div
                className="absolute right-1 z-10 -translate-y-1/2 rounded bg-card px-1 text-[11px] font-medium text-emerald-600 tabular-nums dark:text-emerald-400"
                style={{ top: now.top }}
              >
                {now.label}
              </div>
            )}
          </div>
        </div>
        {columns.map((c, i) => (
          <Column
            key={c.key}
            column={c}
            height={height}
            hours={hours}
            scale={scale}
            now={now !== null && c.date === today ? { top: now.top, dot: i === firstToday } : null}
            {...props}
          />
        ))}
      </div>
    </div>
  );
}

/** How often the line marking the time now moves: under a pixel at the detailed scale. */
const TICK = 30_000;
const everyTick = (onTick: () => void) => {
  const id = setInterval(onTick, TICK);
  return () => clearInterval(id);
};
const tickNow = () => Math.floor(Date.now() / TICK);

/**
 * Today's date, as "2026-09-14", and the minute of the day it is now, both on
 * the viewer's clock; null while rendering on the server.
 */
function useClock(): { date: string; minute: number } | null {
  const tick = useSyncExternalStore(everyTick, tickNow, () => null);
  if (tick === null) return null;
  const now = new Date(tick * TICK);
  return {
    date: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`,
    minute: now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60,
  };
}

/** The attribute naming the column a drop lands in, for measuring where in it. */
export const COLUMN_ATTR = "data-board-column";

function Column({
  column,
  height,
  hours,
  scale,
  now,
  ...props
}: BoardProps & {
  column: BoardColumn;
  height: number;
  hours: number[];
  scale: number;
  /** Where the line marking the time now crosses this column, when it is today; `dot` on the first such column. */
  now: { top: number; dot: boolean } | null;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${column.key}` });
  const gaps = gapsOf(column.sessions);

  return (
    <div className="min-w-48 flex-1 border-r last:border-r-0">
      {/* With an action, both sit at the foot of the header as the corner does, the title level with the action's first line. */}
      <div className={cn(HEADER_HEIGHT, "flex border-b px-3", props.headerAction ? "items-end pb-2" : "flex-col justify-center")}>
        <div className="flex w-full items-start gap-2">
          <div className="line-clamp-2 min-w-0 flex-1 text-sm leading-6">
            <span className="font-medium">{column.title}</span>
            <span className="text-muted-foreground"> · {column.subtitle}</span>
            {column.attendees && (
              <span className="text-muted-foreground tabular-nums" title={`${column.attendees.count} ${column.attendees.noun}`}>
                {" "}
                ({column.attendees.count})
              </span>
            )}
          </div>
          {props.headerAction?.(column)}
        </div>
      </div>
      <div
        ref={setNodeRef}
        {...{ [COLUMN_ATTR]: column.key }}
        className={cn("relative transition-colors", isOver && "bg-brand/4")}
        style={{ height }}
      >
        {hours.map((m) => (
          <div
            key={m}
            aria-hidden
            className={cn(
              "absolute inset-x-0",
              m === dayEnd ? "border-t border-dashed border-red-400/80 dark:border-red-500/70" : "border-t border-border/50",
            )}
            style={{ top: (m - dayStart) * scale }}
          />
        ))}
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 bg-red-500/5 dark:bg-red-500/8"
          style={{ top: (dayEnd - dayStart) * scale }}
        />
        {gaps.map((g) => (
          <Gap
            key={g.start}
            start={g.start}
            minutes={g.minutes}
            scale={scale}
            onAdd={
              props.canManage && column.sessions.length < SCHEDULE_LIMITS.sessionsPerDay
                ? () => props.onAdd(column, g.start)
                : undefined
            }
          />
        ))}
        {column.sessions.map((s) => (
          <DraggableSession key={s.id} session={s} start={s.start} scale={scale} {...props} />
        ))}
        {now !== null && (
          <div
            aria-hidden
            className="pointer-events-none absolute -right-px left-0 z-30 h-0.5 -translate-y-1/2 bg-emerald-500"
            style={{ top: now.top }}
          >
            {now.dot && <div className="absolute top-1/2 -left-1 size-2.5 -translate-y-1/2 rounded-full bg-emerald-500" />}
          </div>
        )}
      </div>
    </div>
  );
}

/** Time nothing is scheduled in; a manager clicks it to add a session there. */
function Gap({ start, minutes, scale, onAdd }: { start: number; minutes: number; scale: number; onAdd?: () => void }) {
  const label = `Unscheduled · ${formatLength(minutes)}`;
  const className = cn(
    "absolute inset-x-1.5 flex items-center justify-center overflow-hidden rounded-md border border-dashed border-border text-[11px] text-muted-foreground tabular-nums",
    onAdd && "transition-colors hover:border-brand-border hover:bg-brand/5 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
  );
  const style = { top: (start - dayStart) * scale, height: minutes * scale - 2 };
  if (!onAdd) {
    return (
      <div className={className} style={style}>
        <span className="truncate px-1">{label}</span>
      </div>
    );
  }
  return (
    <button
      type="button"
      className={className}
      style={style}
      title={`${formatClock(start)}–${formatClock(start + minutes)}: click to add a session`}
      aria-label={`${label} from ${formatClock(start)}: add a session`}
      onClick={onAdd}
    >
      <span className="truncate px-1">{label}</span>
    </button>
  );
}

type CardProps = Pick<BoardProps, "density" | "issues" | "dimmed" | "roomNames" | "canManage" | "resizingId" | "onOpen" | "onResize" | "onResizeEnd"> & {
  session: SessionRow;
  start: number;
  scale: number;
};

function DraggableSession(props: CardProps) {
  const { session, scale, canManage } = props;
  // The card stays put while a copy follows the pointer; where it would land is shown by moving the card itself.
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: session.id, disabled: !canManage });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "absolute inset-x-0 z-10 px-1.5 pb-0.5 transition-opacity",
        isDragging ? "opacity-30" : props.dimmed?.has(session.id) && "opacity-30 hover:opacity-100",
      )}
      style={{ top: (session.start - dayStart) * scale, height: session.minutes * scale }}
    >
      <SessionFace
        {...props}
        handle={{
          ...attributes,
          ...listeners,
          onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => {
            listeners?.onKeyDown?.(e);
            if (e.key === "Enter" && !isDragging) props.onOpen(session);
          },
        }}
      />
    </div>
  );
}

/** The card itself; also drawn under the pointer while it is dragged. */
export function SessionFace({
  session: s,
  start,
  scale,
  density,
  issues,
  roomNames,
  canManage,
  resizingId,
  onOpen,
  onResize,
  onResizeEnd,
  handle,
  lifted,
}: CardProps & { handle?: Record<string, unknown>; lifted?: boolean }) {
  const wrong = issues.get(s.id) ?? [];
  const height = s.minutes * scale - 2;
  const end = start + s.minutes;
  const leader = s.staff.find((p) => p.leader) ?? s.staff[0];
  const rooms =
    s.kind === "main"
      ? s.roomId
        ? [roomNames.get(s.roomId) ?? "A removed room"]
        : []
      : s.kind === "breakout"
        ? s.staff.flatMap((p) => (p.roomId ? [roomNames.get(p.roomId) ?? "A removed room"] : []))
        : [];
  const pace = s.kind === "breakout" ? paceOf(s.minutes, s.largestGroup) : null;
  const people = [leader && `${leader.fullName}${s.staff.length > 1 ? ` +${s.staff.length - 1}` : ""}`, rooms.join(", ")]
    .filter(Boolean)
    .join(" · ");

  // The lines under the name, each shown only when the card is tall enough for it and those above it.
  const lines: { key: string; text: string; className?: string }[] = [
    { key: "time", text: `${formatClock(start)}–${formatClock(end)}`, className: "tabular-nums" },
    ...(pace ? [{ key: "pace", text: pace, className: "tabular-nums" }] : []),
    ...(people ? [{ key: "people", text: people }] : []),
    ...(wrong.length > 0
      ? [{ key: "wrong", text: wrong.length === 1 ? wrong[0]! : `${wrong.length} issues`, className: "font-medium text-red-700 dark:text-red-400" }]
      : []),
  ];
  const fits = Math.max(0, Math.floor((height - 24) / 16));

  const title = [
    `${s.emoji ? `${s.emoji} ` : ""}${s.name}`,
    `${formatClock(start)}–${formatClock(end)} (${formatLength(s.minutes)})`,
    ...(pace ? [`${pace}, for the largest group of ${s.largestGroup}`] : []),
    ...(leader ? [`Led by ${leader.fullName}${s.staff.length > 1 ? ` with ${s.staff.length - 1} more` : ""}`] : []),
    ...(rooms.length > 0 ? [rooms.join(", ")] : []),
    ...wrong.map((w) => `⚠ ${w}`),
  ].join("\n");

  return (
    <div
      role="button"
      tabIndex={0}
      title={title}
      {...handle}
      onClick={() => onOpen(s)}
      onKeyDown={(handle?.onKeyDown as ((e: KeyboardEvent<HTMLDivElement>) => void) | undefined) ?? ((e) => e.key === "Enter" && onOpen(s))}
      className={cn(
        "group relative flex h-full flex-col overflow-hidden rounded-md border border-l-4 text-left outline-none select-none",
        "focus-visible:ring-[3px] focus-visible:ring-ring/50",
        canManage ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
        SESSION_STYLES[s.color].card,
        // An issue outweighs the session's colour: a red edge, and a red halo clear of the card.
        wrong.length > 0 && "border-red-600 ring-2 ring-red-600 ring-offset-1 ring-offset-card dark:border-red-500 dark:ring-red-500",
        lifted && "shadow-lg ring-2 ring-brand/50",
        density === "condensed" ? "justify-center px-1.5" : "px-2 py-1",
      )}
      style={{ height }}
    >
      <div className="flex min-w-0 items-center gap-1">
        {wrong.length > 0 && <AlertTriangle className="size-3.5 shrink-0 text-red-600 dark:text-red-400" aria-label="Has issues" />}
        {s.emoji && (
          <span aria-hidden className="shrink-0 text-xs leading-none">
            {s.emoji}
          </span>
        )}
        <span className={cn("min-w-0 flex-1 truncate leading-tight", density === "condensed" ? "text-[11px]" : "text-[13px] font-medium")}>
          {s.name}
        </span>
        {density === "detailed" && (
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{formatLength(s.minutes)}</span>
        )}
        {s.comments > 0 && density === "detailed" && (
          <span className="flex shrink-0 items-center gap-0.5 text-xs text-muted-foreground">
            <MessageSquare className="size-3" />
            {s.comments}
          </span>
        )}
      </div>
      {density === "detailed" &&
        lines.slice(0, fits).map((l) => (
          <div key={l.key} className={cn("truncate text-xs text-muted-foreground", l.className)}>
            {l.text}
          </div>
        ))}
      {resizingId === s.id && (
        <div className="pointer-events-none absolute right-1 bottom-1.5 rounded bg-foreground px-1.5 py-0.5 text-[11px] font-medium text-background tabular-nums">
          {formatLength(s.minutes)} · ends {formatClock(end)}
        </div>
      )}
      {canManage && !lifted && (
        <ResizeHandle minutes={s.minutes} scale={scale} onResize={(m) => onResize(s.id, m)} onEnd={() => onResizeEnd(s.id)} />
      )}
    </div>
  );
}

/** "14m/attendee": a breakout's length shared among its largest group, to the nearest minute; null before anyone is assigned. */
function paceOf(minutes: number, largestGroup: number): string | null {
  if (largestGroup <= 0) return null;
  const each = Math.round(minutes / largestGroup);
  return each > 0 ? `${each}m/attendee` : "<1m/attendee";
}

/** The bottom edge of a card: drag it to make the session longer or shorter, a quarter hour at a time. */
function ResizeHandle({
  minutes,
  scale,
  onResize,
  onEnd,
}: {
  minutes: number;
  scale: number;
  onResize: (minutes: number) => void;
  onEnd: () => void;
}) {
  const from = useRef<{ y: number; minutes: number } | null>(null);

  const down = (e: PointerEvent<HTMLDivElement>) => {
    // Kept from the card, which would otherwise start dragging it.
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    from.current = { y: e.clientY, minutes };
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (!from.current) return;
    onResize(snapMinutes(from.current.minutes + (e.clientY - from.current.y) / scale));
  };
  const up = (e: PointerEvent<HTMLDivElement>) => {
    if (!from.current) return;
    from.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
    onEnd();
  };

  return (
    <div
      aria-hidden
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onClick={(e) => e.stopPropagation()}
      className="absolute inset-x-0 bottom-0 flex h-2 cursor-ns-resize items-end justify-center"
    >
      <div className="mb-0.5 h-0.5 w-8 rounded-full bg-foreground/0 transition-colors group-hover:bg-foreground/30" />
    </div>
  );
}
