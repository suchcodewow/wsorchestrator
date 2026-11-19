"use client";

/**
 * The schedule drawn to scale: a column per track-day, each session as tall
 * as it is long and placed at its start, from 8 AM. Time nothing is scheduled
 * in shows as Unscheduled, the evening's included; past 5 PM is tinted red,
 * though sessions belong there as much as earlier. A column whose date is
 * today has a green line across it at the current time, moving as the clock
 * does, in either view. A manager drags a card to
 * any time in any column, drags its bottom edge to change its length a
 * quarter hour at a time, and clicks unscheduled time to add a session there.
 *
 * Sessions side by side share the column's width, the first on the left and
 * the newest on the right, and a shorter one's leftover time is unscheduled.
 * The one under the pointer widens so it can be read. The right edge of the
 * rightmost card has a +, while there is room for another lane: clicking it
 * adds a session beside that card, and dropping a dragged card on it puts
 * that card there.
 */

import { useRef, useState, useSyncExternalStore, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { useDndContext, useDraggable, useDroppable } from "@dnd-kit/core";
import { AlertTriangle, MessageSquare, Plus } from "lucide-react";
import { SCHEDULE_LIMITS, type ScheduleTrack } from "@/db/schema";
import type { SessionRow } from "@/lib/scheduler/schedule";
import { SESSION_STYLES } from "@/lib/scheduler/session-style";
import { dayTotal, formatClock, formatLength, gapsOf, sideBySide, snapMinutes } from "@/lib/scheduler/timeline";
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

/** Each column's footer, when there is one, and the gutter's blank corner beside it. */
const FOOTER_HEIGHT = "h-13";

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
  /** Adds a session to a column at `start`; in `lane` for `minutes` when put beside others. */
  onAdd: (column: BoardColumn, start: number, beside?: { lane: number; minutes: number }) => void;
  onResize: (id: string, minutes: number) => void;
  onResizeEnd: (id: string) => void;
  /** Anything more to show at the top of a column, to the right of its title and level with `corner`. */
  headerAction?: (column: BoardColumn) => ReactNode;
  /** Anything to show in the top-left corner, above the hours, level with each column's `headerAction`. */
  corner?: ReactNode;
  /** Anything to show at the foot of a column, below the day's last hour. */
  footerAction?: (column: BoardColumn) => ReactNode;
  /** Anything to pin over a column's hours, each placed by `top`, its pixels down from 8 AM. */
  marks?: (column: BoardColumn, top: (minute: number) => number) => ReactNode;
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
          {props.footerAction && <div aria-hidden className={cn(FOOTER_HEIGHT, "border-t")} />}
        </div>
        {columns.map((c, i) => (
          <Column
            key={c.key}
            column={c}
            height={height}
            hours={hours}
            bottom={bottom}
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
export function useClock(): { date: string; minute: number } | null {
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

/** How the + at a card's right edge is named as a drop target: this, then the card's session id. */
export const BESIDE_PREFIX = "beside:";

/** The share of a group's width the card under the pointer widens to, by how many are side by side. */
const WIDENED: Record<number, number> = { 2: 90, 3: 80 };

/** Where a card or unscheduled time sits across its column, in percent, and its padding either side. */
type Box = { left: number; width: number; padLeft: string; padRight: string };

const OUTER_PAD = "0.375rem";
const INNER_PAD = "0.125rem";

/** Each lane's box in a group of `count` side by side, the `wide`-th widened, or none. */
function boxes(count: number, wide: number): Box[] {
  const widths =
    wide >= 0 && count > 1
      ? Array.from({ length: count }, (_, i) => (i === wide ? WIDENED[count]! : (100 - WIDENED[count]!) / (count - 1)))
      : Array.from({ length: count }, () => 100 / count);
  let left = 0;
  return widths.map((width, i) => {
    const box = { left, width, padLeft: i === 0 ? OUTER_PAD : INNER_PAD, padRight: i === count - 1 ? OUTER_PAD : INNER_PAD };
    left += width;
    return box;
  });
}

/**
 * The session whose + a pointer at (`x`, `y`) is over, with `sessions` laid
 * out in `column` as the board draws them while a card is dragged; none when
 * it is over no +. `dragged` has no + of its own. Worked out from the
 * sessions rather than from the + on screen, so a drag can find the + where
 * a card stood before the preview pushed it away.
 */
export function besideAt(
  column: Element,
  sessions: readonly SessionRow[],
  scale: number,
  x: number,
  y: number,
  dragged: string,
): string | null {
  const r = column.getBoundingClientRect();
  if (x < r.left || x > r.right || y < r.top || y > r.bottom || sessions.length >= SCHEDULE_LIMITS.sessionsPerDay) return null;
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  for (const g of sideBySide(sessions)) {
    const box = boxes(g.columns.length, -1).at(-1)!;
    const right = r.left + ((box.left + box.width) / 100) * r.width - parseFloat(box.padRight) * rem;
    const left = r.left + (box.left / 100) * r.width + parseFloat(box.padLeft) * rem;
    const strip = Math.max((BESIDE_DROP.share / 100) * (right - left), BESIDE_DROP.min * rem);
    if (x < right - strip || x > right) continue;
    const s = g.columns.at(-1)!.sessions.find((s) => {
      const top = r.top + (s.start - dayStart) * scale;
      return s.id !== dragged && s.lane + 1 < SCHEDULE_LIMITS.lanes && y >= top && y < top + s.minutes * scale;
    });
    if (s) return s.id;
  }
  return null;
}

function Column({
  column,
  height,
  hours,
  bottom,
  scale,
  now,
  ...props
}: BoardProps & {
  column: BoardColumn;
  height: number;
  hours: number[];
  /** The minute the board's last line marks; unscheduled time runs to it. */
  bottom: number;
  scale: number;
  /** Where the line marking the time now crosses this column, when it is today; `dot` on the first such column. */
  now: { top: number; dot: boolean } | null;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${column.key}` });
  const gaps = gapsOf(column.sessions, bottom);
  const groups = sideBySide(column.sessions);
  const [hovered, setHovered] = useState<string | null>(null);
  const { active } = useDndContext();
  const dragging = active !== null;
  const roomForMore = column.sessions.length < SCHEDULE_LIMITS.sessionsPerDay;

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
        {/* The header's bottom border already marks the day's start. */}
        {hours
          .filter((m) => m !== dayStart)
          .map((m) => (
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
            onAdd={props.canManage && roomForMore ? () => props.onAdd(column, g.start) : undefined}
          />
        ))}
        {groups.flatMap((g) => {
          const wide = dragging ? -1 : g.columns.findIndex((c) => c.sessions.some((s) => s.id === hovered));
          const laid = boxes(g.columns.length, wide);
          return g.columns.flatMap((c, i) => {
            const box = laid[i]!;
            const rightmost = i === g.columns.length - 1;
            return [
              ...c.gaps.map((gap) => (
                <Gap
                  key={`gap:${c.lane}:${gap.start}`}
                  start={gap.start}
                  minutes={gap.minutes}
                  scale={scale}
                  box={box}
                  onAdd={
                    props.canManage && roomForMore
                      ? () => props.onAdd(column, gap.start, { lane: c.lane, minutes: Math.min(gap.minutes, SCHEDULE_LIMITS.maxMinutes) })
                      : undefined
                  }
                />
              )),
              ...c.sessions.map((s) => (
                <DraggableSession
                  key={s.id}
                  session={s}
                  start={s.start}
                  scale={scale}
                  box={box}
                  onHover={(on) => setHovered((now) => (on ? s.id : now === s.id ? null : now))}
                  onBeside={
                    props.canManage && roomForMore && rightmost && s.lane + 1 < SCHEDULE_LIMITS.lanes
                      ? () => props.onAdd(column, s.start, { lane: s.lane + 1, minutes: s.minutes })
                      : undefined
                  }
                  dragging={dragging}
                  {...props}
                />
              )),
            ];
          });
        })}
        {props.marks?.(column, (minute) => (Math.min(bottom, Math.max(dayStart, minute)) - dayStart) * scale)}
        {now !== null && (
          <div
            aria-hidden
            className="pointer-events-none absolute -right-px left-0 z-30 h-px -translate-y-1/2 bg-emerald-500"
            style={{ top: now.top }}
          >
            {now.dot && <div className="absolute top-1/2 -left-1 size-2.5 -translate-y-1/2 rounded-full bg-emerald-500" />}
          </div>
        )}
      </div>
      {props.footerAction && (
        <div className={cn(FOOTER_HEIGHT, "flex items-center justify-center border-t px-3")}>{props.footerAction(column)}</div>
      )}
    </div>
  );
}

/** Time nothing is scheduled in, across the column or in one lane of sessions side by side; a manager clicks it to add a session there. */
function Gap({ start, minutes, scale, box, onAdd }: { start: number; minutes: number; scale: number; box?: Box; onAdd?: () => void }) {
  const label = `Unscheduled · ${formatLength(minutes)}`;
  const className = cn(
    "absolute flex items-center justify-center overflow-hidden rounded-md border border-dashed border-border text-[11px] text-muted-foreground tabular-nums",
    box ? "transition-[left,width,color,background-color,border-color] duration-200 ease-out" : "inset-x-1.5 transition-colors",
    onAdd &&
      "hover:border-brand-border hover:bg-brand/5 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
  );
  const style = {
    top: (start - dayStart) * scale,
    height: minutes * scale - 2,
    ...(box && { left: `calc(${box.left}% + ${box.padLeft})`, width: `calc(${box.width}% - ${box.padLeft} - ${box.padRight})` }),
  };
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

type CardProps = Pick<
  BoardProps,
  "density" | "issues" | "dimmed" | "roomNames" | "canManage" | "resizingId" | "onOpen" | "onResize" | "onResizeEnd"
> & {
  session: SessionRow;
  start: number;
  scale: number;
};

function DraggableSession({
  box,
  onHover,
  onBeside,
  dragging,
  ...props
}: CardProps & {
  box: Box;
  onHover: (on: boolean) => void;
  /** Adds a session beside this one; left out where none can go. */
  onBeside?: () => void;
  /** Whether any card is being dragged, so the + shows on every card it could be dropped beside. */
  dragging: boolean;
}) {
  const { session, scale, canManage } = props;
  // The card stays put while a copy follows the pointer; where it would land is shown by moving the card itself.
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: session.id, disabled: !canManage });
  const beside = useDroppable({ id: `${BESIDE_PREFIX}${session.id}`, disabled: !onBeside || isDragging });
  const [atEdge, setAtEdge] = useState(false);
  // Open, the + takes the right edge and the card's text moves over to make room for it.
  const open = Boolean(onBeside) && !isDragging && (beside.isOver || (atEdge && !dragging));
  return (
    <div
      ref={setNodeRef}
      onPointerEnter={() => onHover(true)}
      onPointerLeave={() => onHover(false)}
      className={cn(
        "group/card absolute z-10 py-px transition-[left,width,opacity] duration-200 ease-out",
        isDragging ? "opacity-30" : props.dimmed?.has(session.id) && "opacity-30 hover:opacity-100",
      )}
      style={{
        top: (session.start - dayStart) * scale,
        height: session.minutes * scale,
        left: `${box.left}%`,
        width: `${box.width}%`,
        paddingLeft: box.padLeft,
        paddingRight: box.padRight,
      }}
    >
      <div className="relative h-full">
        <div className="h-full transition-[margin] duration-150 ease-out" style={{ marginRight: open ? besideWidth(dragging) : 0 }}>
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
        {onBeside && !isDragging && (
          <BesideButton
            session={session}
            dropRef={beside.setNodeRef}
            open={open}
            dragging={dragging}
            onEdge={setAtEdge}
            onClick={onBeside}
          />
        )}
      </div>
    </div>
  );
}

/** How much of a card's right edge the + takes, in percent of the card and at least `min` rem: a tenth of it, never too narrow to aim at. */
const BESIDE_HOVER = { share: 10, min: 1 };
/** The same while a card is dragged, wider, so a card can be dropped beside another on a narrow column too. */
const BESIDE_DROP = { share: 20, min: 2 };
const besideWidth = (dragging: boolean) => {
  const { share, min } = dragging ? BESIDE_DROP : BESIDE_HOVER;
  return `max(${share}%, ${min}rem)`;
};

/**
 * The + along a card's right edge. It opens when the pointer reaches that
 * edge, or a dragged card is held over it, pushing the card's text over;
 * while a card is dragged, every card it could go beside marks its edge.
 * Clicking it adds a session beside the card; dropping a card on it puts
 * that card there.
 */
function BesideButton({
  session,
  dropRef,
  open,
  dragging,
  onEdge,
  onClick,
}: {
  session: SessionRow;
  dropRef: (node: HTMLElement | null) => void;
  open: boolean;
  dragging: boolean;
  onEdge: (on: boolean) => void;
  onClick: () => void;
}) {
  return (
    <button
      ref={dropRef}
      type="button"
      aria-label={`Add a session beside ${session.name}`}
      title={dragging ? `Drop to put it beside ${session.name}` : `Add a session beside ${session.name}`}
      onPointerEnter={() => onEdge(true)}
      onPointerLeave={() => onEdge(false)}
      onFocus={() => onEdge(true)}
      onBlur={() => onEdge(false)}
      // Kept from the card, which would otherwise start dragging it.
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        "absolute inset-y-0 right-0 z-20 flex items-center justify-center rounded-md border border-dashed text-brand transition-[opacity,background-color,border-color] duration-150",
        "focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
        open
          ? "border-brand-border bg-brand/15 opacity-100 hover:bg-brand/20"
          : // While a card is dragged, a thin line at the edge says it can go beside this one.
            dragging
            ? "border-transparent opacity-100"
            : "border-transparent opacity-0",
      )}
      style={{ width: besideWidth(dragging) }}
    >
      {open ? (
        <Plus className="size-3.5 shrink-0" />
      ) : (
        dragging && <span aria-hidden className="absolute inset-y-1 right-0 w-0.5 rounded-full bg-brand/60" />
      )}
    </button>
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
      ? [
          {
            key: "wrong",
            text: wrong.length === 1 ? wrong[0]! : `${wrong.length} issues`,
            className: "font-medium text-red-700 dark:text-red-400",
          },
        ]
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
        // An issue outweighs the session's colour: a thin red edge.
        wrong.length > 0 && "border-red-600 dark:border-red-500",
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
        {density === "detailed" && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{formatLength(s.minutes)}</span>}
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
