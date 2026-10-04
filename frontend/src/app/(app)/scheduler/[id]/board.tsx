"use client";

/**
 * The schedule drawn to scale: a column per track-day, each session as tall
 * as it is long and placed at its start, from 8 AM. Time nothing is scheduled
 * in shows as Unscheduled; past 5 PM is tinted red. A manager drags a card to
 * any time in any column, drags its bottom edge to change its length a
 * quarter hour at a time, and clicks unscheduled time to add a session there.
 */

import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { AlertTriangle, MessageSquare, Plus, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SCHEDULE_LIMITS, type ScheduleTrack } from "@/db/schema";
import type { SessionRow } from "@/lib/scheduler/schedule";
import { SESSION_STYLES } from "@/lib/scheduler/session-style";
import { type Clash, dayTotal, formatClock, formatLength, gapsOf, snapMinutes } from "@/lib/scheduler/timeline";
import { cn } from "@/lib/utils";

export type Density = "detailed" | "condensed";

export type BoardColumn = {
  key: string;
  track: ScheduleTrack;
  day: number;
  title: string;
  subtitle: string;
  sessions: SessionRow[];
};

/** Pixels per minute in each density: a quarter hour is 28px detailed, 16px condensed. */
export const SCALE: Record<Density, number> = { detailed: 28 / 15, condensed: 16 / 15 };

const { dayStart, dayEnd } = SCHEDULE_LIMITS;

export type BoardProps = {
  columns: BoardColumn[];
  density: Density;
  /** Each session's clashes, by id; sessions with none are absent. */
  clashes: Map<string, Clash[]>;
  roomNames: Map<string, string>;
  canManage: boolean;
  /** The session being resized, to label its new length as it changes. */
  resizingId: string | null;
  onOpen: (session: SessionRow) => void;
  /** Adds a session to a column, at `start` or after its last one. */
  onAdd: (column: BoardColumn, start?: number) => void;
  onResize: (id: string, minutes: number) => void;
  onResizeEnd: (id: string) => void;
};

export function Board(props: BoardProps) {
  const { columns, density } = props;
  const scale = SCALE[density];
  const lastEnd = Math.max(dayEnd, ...columns.map((c) => dayTotal(c.sessions).end));
  // An hour of room below the latest session, to drop a card after it.
  const bottom = Math.ceil((lastEnd + 60) / 60) * 60;
  const height = (bottom - dayStart) * scale;
  const hours = Array.from({ length: (bottom - dayStart) / 60 + 1 }, (_, i) => dayStart + i * 60);

  return (
    // `overflow-x-auto` alone makes the board a vertical scroller too; it never scrolls that way, so the wheel moves the page.
    <div className="overflow-x-auto overflow-y-hidden rounded-2xl border bg-card shadow-sm">
      {/* Columns share the width and scroll only below 12rem each; `min-w-fit` would size them to their longest name. */}
      <div className="flex" style={{ minWidth: `calc(4rem + ${columns.length} * 12rem)` }}>
        <div className="sticky left-0 z-20 w-16 shrink-0 border-r bg-card">
          <div className="h-20 border-b" />
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
          </div>
        </div>
        {columns.map((c) => (
          <Column key={c.key} column={c} height={height} hours={hours} scale={scale} {...props} />
        ))}
      </div>
    </div>
  );
}

/** The attribute naming the column a drop lands in, for measuring where in it. */
export const COLUMN_ATTR = "data-board-column";

function Column({
  column,
  height,
  hours,
  scale,
  ...props
}: BoardProps & { column: BoardColumn; height: number; hours: number[]; scale: number }) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${column.key}` });
  const total = dayTotal(column.sessions);
  const gaps = gapsOf(column.sessions);

  return (
    <div className="min-w-48 flex-1 border-r last:border-r-0">
      <div className="flex h-20 items-start justify-between gap-2 border-b px-3 py-2.5">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{column.title}</div>
          <div className="truncate text-xs text-muted-foreground">{column.subtitle}</div>
          <div
            className={cn(
              "mt-1 truncate text-xs tabular-nums",
              total.over > 0 ? "font-medium text-red-600 dark:text-red-400" : "text-muted-foreground",
            )}
          >
            {column.sessions.length === 0
              ? "Nothing yet"
              : // What is unscheduled or over leads, so a narrow column truncates the end time instead.
                [
                  total.over > 0 && `${formatLength(total.over)} over`,
                  total.left > 0 && `${formatLength(total.left)} unscheduled`,
                  total.over === 0 && total.left === 0 && "Full day",
                  `ends ${formatClock(total.end)}`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
          </div>
        </div>
        {props.canManage && (
          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0"
            aria-label={`Add a session to ${column.title}, ${column.subtitle}`}
            disabled={column.sessions.length >= SCHEDULE_LIMITS.sessionsPerDay}
            onClick={() => props.onAdd(column)}
          >
            <Plus className="size-4" />
          </Button>
        )}
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

type CardProps = Pick<BoardProps, "density" | "clashes" | "roomNames" | "canManage" | "resizingId" | "onOpen" | "onResize" | "onResizeEnd"> & {
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
      className={cn("absolute inset-x-0 z-10 px-1.5 pb-0.5", isDragging && "opacity-30")}
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
  clashes,
  roomNames,
  canManage,
  resizingId,
  onOpen,
  onResize,
  onResizeEnd,
  handle,
  lifted,
}: CardProps & { handle?: Record<string, unknown>; lifted?: boolean }) {
  const mine = clashes.get(s.id) ?? [];
  const height = s.minutes * scale - 2;
  const end = start + s.minutes;
  const leader = s.staff.find((p) => p.leader) ?? s.staff[0];
  const leaderless = s.kind !== "unstructured" && s.staff.length === 0;
  const rooms =
    s.kind === "main"
      ? s.roomId
        ? [roomNames.get(s.roomId) ?? "A removed room"]
        : []
      : s.kind === "breakout"
        ? s.staff.flatMap((p) => (p.roomId ? [roomNames.get(p.roomId) ?? "A removed room"] : []))
        : [];
  const pastEnd = end > dayEnd;

  const title = [
    `${s.emoji ? `${s.emoji} ` : ""}${s.name}`,
    `${formatClock(start)}–${formatClock(end)} (${formatLength(s.minutes)})`,
    ...(leader ? [`Led by ${leader.fullName}${s.staff.length > 1 ? ` with ${s.staff.length - 1} more` : ""}`] : []),
    ...(rooms.length > 0 ? [rooms.join(", ")] : []),
    ...(leaderless ? ["No leader yet"] : []),
    ...mine.map((c) => `Clash: ${c.what.kind === "person" ? c.what.fullName : (roomNames.get(c.what.roomId) ?? "a room")} is also in ${c.name}`),
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
        mine.length > 0 && "border-red-500 ring-1 ring-red-500 dark:border-red-500",
        pastEnd && mine.length === 0 && "border-dashed",
        lifted && "shadow-lg ring-2 ring-brand/50",
        density === "condensed" ? "justify-center px-1.5" : "px-2 py-1",
      )}
      style={{ height }}
    >
      <div className="flex min-w-0 items-center gap-1">
        {mine.length > 0 && <AlertTriangle className="size-3 shrink-0 text-red-600 dark:text-red-400" aria-label="Clashes" />}
        {s.emoji && (
          <span aria-hidden className="shrink-0 text-xs leading-none">
            {s.emoji}
          </span>
        )}
        <span className={cn("min-w-0 flex-1 truncate leading-tight", density === "condensed" ? "text-[11px]" : "text-xs font-medium")}>
          {s.name}
        </span>
        {density === "detailed" && (
          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{formatLength(s.minutes)}</span>
        )}
        {leaderless && density === "detailed" && <UserX className="size-3 shrink-0 text-amber-600" aria-label="No leader yet" />}
        {s.comments > 0 && density === "detailed" && (
          <span className="flex shrink-0 items-center gap-0.5 text-[11px] text-muted-foreground">
            <MessageSquare className="size-3" />
            {s.comments}
          </span>
        )}
      </div>
      {density === "detailed" && height >= 40 && (
        <div className="truncate text-[11px] tabular-nums text-muted-foreground">
          {formatClock(start)}–{formatClock(end)}
        </div>
      )}
      {density === "detailed" && height >= 58 && (leader || rooms.length > 0) && (
        <div className="truncate text-[11px] text-muted-foreground">
          {[leader && `${leader.fullName}${s.staff.length > 1 ? ` +${s.staff.length - 1}` : ""}`, rooms.join(", ")]
            .filter(Boolean)
            .join(" · ")}
        </div>
      )}
      {density === "detailed" && height >= 76 && mine.length > 0 && (
        <div className="truncate text-[11px] font-medium text-red-700 dark:text-red-400">
          {mine.length === 1 ? `Clashes with ${mine[0]!.name}` : `${mine.length} clashes`}
        </div>
      )}
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
