"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import gsap from "gsap";
import { ChevronLeft, ChevronRight, Plus, Swords } from "lucide-react";
import { DAY_SECONDS } from "@/db/schema";
import type { CalendarScope, Cloud, EventMode, RunStatus } from "@/db/schema";
import { Button } from "@/components/ui/button";
import {
  statusChip,
  statusDot,
  isActiveStatus,
} from "@/components/status-badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { EASE, SPRING_SNAPPY } from "@/lib/motion";
import { CreateEventDialog } from "./create-event-dialog";

type CalendarEvent = {
  id: string;
  name: string;
  mode: EventMode;
  status: RunStatus;
  scheduledStart: string | null;
  /** Lifetime chosen on the form, in seconds — used before it goes live. */
  ttlSeconds: number;
  /** The real teardown moment, once known; overrides `ttlSeconds`. */
  expiresAt: string | null;
  userCount: number;
  clouds: Cloud[];
  /** Who booked it, when that is somebody other than the viewer. */
  owner: string | null;
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DAY_MS = 86_400_000;

/**
 * A calendar-day index — days since the epoch in local time, so subtracting two
 * gives whole days between dates regardless of the time of day within them.
 */
function dayNum(d: Date): number {
  const midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round(midnight.getTime() / DAY_MS);
}

/** Where in its day a moment sits, 0 (midnight) → 1 (the next midnight). */
function dayFraction(d: Date): number {
  return (d.getHours() + d.getMinutes() / 60) / 24;
}

/**
 * How many whole days an event occupies on the calendar. Once it is live the
 * real span is `expiresAt − start`; before that it is the lifetime picked on
 * the form. At least one day, so a same-day event still gets a cell.
 */
function durationDays(e: CalendarEvent, start: Date): number {
  const seconds = e.expiresAt
    ? (new Date(e.expiresAt).getTime() - start.getTime()) / 1000
    : e.ttlSeconds;
  return Math.max(1, Math.round(seconds / DAY_SECONDS));
}

/**
 * How often the "now" line is re-placed. A minute is the resolution the line
 * is drawn at (`dayFraction` reads hours and minutes), so anything finer would
 * re-render without moving it.
 */
const NOW_TICK_MS = 60_000;

/** Layout metrics for the day cells and the bars laid over them (px). */
const DATE_ROW = 34; // room for the date number before bars begin
const LANE = 26; // height of one bar row, including its gap
const BASE_CELL = 120; // a week with no events is still this tall

/** Human summary for a bar's tooltip: when it starts, how long, when it ends. */
function eventTitle(e: CalendarEvent, days: number): string {
  const span = `${days} day${days === 1 ? "" : "s"}`;
  const starts = e.scheduledStart
    ? `starts ${new Date(e.scheduledStart).toLocaleString()} · `
    : "";
  const ends = e.expiresAt
    ? `, ends ${new Date(e.expiresAt).toLocaleString()}`
    : "";
  return `${e.name} · ${starts}runs ${span}${ends}`;
}

export function EventCalendar({
  events,
  scope,
}: {
  events: CalendarEvent[];
  /** `all` only reaches here for a manager and above; set from the menu. */
  scope: CalendarScope;
}) {
  const router = useRouter();
  const today = new Date();
  const [view, setView] = useState(
    () => new Date(today.getFullYear(), today.getMonth(), 1),
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [initialDate, setInitialDate] = useState<Date | null>(null);
  const [mode, setMode] = useState<EventMode>("workshop");

  /**
   * The moment the "now" line marks, or null before it is known.
   *
   * Null until mount on purpose: this is rendered on the server too, and the
   * server's clock is not the viewer's — a line placed during SSR would be
   * drawn at the wrong minute and then jump, or trip a hydration mismatch. It
   * appears on the first client tick instead, and moves once a minute after.
   */
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const timer = setInterval(tick, NOW_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const year = view.getFullYear();
  const month = view.getMonth();
  const gridRef = useRef<HTMLDivElement>(null);
  // Skips the entrance animation on first paint, so arriving at the page is
  // not the same event as deliberately changing month.
  const mounted = useRef(false);

  // Place every event on a horizontal lane, so an event keeps the same row as
  // its bar crosses days and weeks and never collides with another. Longer,
  // earlier events claim the top lanes; a later one drops to the first lane
  // free on its start day (interval packing).
  const placed = useMemo(() => {
    const spans = events
      .filter((e) => e.scheduledStart)
      .map((e) => {
        const start = new Date(e.scheduledStart!);
        const startNum = dayNum(start);
        const days = durationDays(e, start);
        // The real teardown moment drives the right edge, mirroring the start:
        // `expiresAt` once known, otherwise start + the chosen lifetime.
        const end = e.expiresAt
          ? new Date(e.expiresAt)
          : new Date(start.getTime() + e.ttlSeconds * 1000);
        let endNum = dayNum(end);
        let endFraction = dayFraction(end);
        // An end at midnight fills the previous day to its edge rather than
        // opening a zero-width sliver at the start of the next one.
        if (endFraction === 0) {
          endNum -= 1;
          endFraction = 1;
        }
        // Guard odd data: never end before it starts.
        if (endNum < startNum) {
          endNum = startNum;
          endFraction = Math.max(endFraction, dayFraction(start));
        }
        // Start/end fractions inset the bar into their day cells (0 = flush
        // left edge / midnight, 1 = flush right edge / next midnight), so a
        // noon start sits halfway across its cell and a 9am end 3/8 across its.
        return {
          e,
          startNum,
          endNum,
          days,
          startFraction: dayFraction(start),
          endFraction,
        };
      })
      .sort(
        (a, b) => a.startNum - b.startNum || b.days - a.days,
      );

    const laneEnds: number[] = []; // last day occupied, per lane
    const lane = new Map<string, number>();
    for (const s of spans) {
      let l = laneEnds.findIndex((end) => end < s.startNum);
      if (l === -1) l = laneEnds.length;
      laneEnds[l] = s.endNum;
      lane.set(s.e.id, l);
    }
    return { spans, lane };
  }, [events]);

  // Build the grid: leading blanks + days, padded to full weeks.
  const cells = useMemo(() => {
    const startWeekday = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const arr: (number | null)[] = [];
    for (let i = 0; i < startWeekday; i++) arr.push(null);
    for (let d = 1; d <= daysInMonth; d++) arr.push(d);
    while (arr.length % 7 !== 0) arr.push(null);
    return arr;
  }, [year, month]);

  // Slice the month into weeks and, for each, the bar segments that fall in it.
  // An event spanning several weeks contributes one segment per week; each is
  // capped (rounded) only on the end that is the event's true start or finish,
  // so continuations read as a single run flowing across the rows.
  const weeks = useMemo(() => {
    const startWeekday = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const monthFirstNum = dayNum(new Date(year, month, 1));
    const lastNum = monthFirstNum + daysInMonth - 1;

    const out: {
      days: (number | null)[];
      segments: {
        e: CalendarEvent;
        lane: number;
        colStart: number; // 0-based column within the week
        span: number;
        roundLeft: boolean;
        roundRight: boolean;
        days: number;
        // Fractions of one day-cell to inset the left and right edges by, so
        // the bar begins at the start hour and ends at the end hour. Only the
        // true-start / true-end segments carry a non-zero inset.
        offset: number;
        endInset: number;
      }[];
      minHeight: number;
    }[] = [];

    for (let w = 0; w * 7 < cells.length; w++) {
      const days = cells.slice(w * 7, w * 7 + 7);
      const weekLoNum = monthFirstNum + Math.max(1, w * 7 - startWeekday + 1) - 1;
      const weekHiNum =
        monthFirstNum + Math.min(daysInMonth, w * 7 + 6 - startWeekday + 1) - 1;

      const segments = [];
      for (const s of placed.spans) {
        const clipStart = Math.max(s.startNum, weekLoNum);
        const clipEnd = Math.min(s.endNum, weekHiNum);
        if (clipStart > clipEnd) continue;

        const colStart = startWeekday + (clipStart - monthFirstNum + 1) - 1 - w * 7;
        // Cap the left only where the event truly begins (and is on-month);
        // the right only where it truly ends.
        const roundLeft = clipStart === s.startNum && s.startNum >= monthFirstNum;
        const roundRight = clipEnd === s.endNum && s.endNum <= lastNum;
        segments.push({
          e: s.e,
          lane: placed.lane.get(s.e.id)!,
          colStart,
          span: clipEnd - clipStart + 1,
          roundLeft,
          roundRight,
          days: s.days,
          // The hour-of-day insets only apply on the segments that carry the
          // real start / end; continuations across weeks run edge to edge.
          offset: roundLeft ? s.startFraction : 0,
          endInset: roundRight ? 1 - s.endFraction : 0,
        });
      }

      const laneCount = segments.reduce((m, s) => Math.max(m, s.lane + 1), 0);
      out.push({
        days,
        segments,
        minHeight: Math.max(BASE_CELL, DATE_ROW + laneCount * LANE + 8),
      });
    }
    return out;
  }, [cells, placed, year, month]);

  /*
   * Changing month sweeps the day cells in on a short stagger. GSAP owns this
   * rather than Framer because it is one gesture across ~35 siblings that are
   * replaced wholesale — a per-cell variant would re-run on every unrelated
   * state change and needs the whole grid kept mounted to sequence properly.
   */
  useLayoutEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    const grid = gridRef.current;
    if (!grid) return;

    const ctx = gsap.context(() => {
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.from(grid.querySelectorAll("[data-cell]"), {
          opacity: 0,
          y: 6,
          duration: 0.34,
          ease: "power2.out",
          stagger: { each: 0.008, from: "start" },
        });
      });
      return () => mm.revert();
    }, grid);

    return () => ctx.revert();
  }, [year, month]);

  const isToday = (d: number) =>
    d === today.getDate() &&
    month === today.getMonth() &&
    year === today.getFullYear();

  /**
   * Which column of a given week holds the current moment, or null if it is
   * not in that week at all — including every week of a month the viewer has
   * paged away from, where "now" is off the grid entirely.
   */
  function nowColumn(days: (number | null)[]): number | null {
    if (!now) return null;
    if (now.getFullYear() !== year || now.getMonth() !== month) return null;
    const col = days.indexOf(now.getDate());
    return col === -1 ? null : col;
  }

  function openCreate(date: Date | null) {
    setInitialDate(date);
    setMode("workshop");
    setDialogOpen(true);
  }

  function openChallenge() {
    setInitialDate(null);
    setMode("challenge");
    setDialogOpen(true);
  }

  return (
    <TooltipProvider>
    <div className="space-y-8">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: EASE }}
        className="flex flex-wrap items-end justify-between gap-4"
      >
        <div className="space-y-1.5">
          <h1 className="text-3xl font-medium tracking-tight">Events</h1>
          <p className="text-muted-foreground">
            {scope === "all"
              ? "Every user's events. Anything you create here is still your own."
              : "Schedule events — each provisions automatically at its start time."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={openChallenge}>
            <Swords /> Challenge Mode
          </Button>
          <Button variant="brand" onClick={() => openCreate(null)}>
            <Plus /> Create workshop
          </Button>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: EASE, delay: 0.06 }}
        // Opaque: a translucent card let the backdrop show through the grid
        // lines and muddied every cell.
        className="overflow-hidden rounded-2xl border bg-card shadow-sm"
      >
        <div className="flex items-center justify-between border-b px-5 py-4">
          {/* Keyed so the month name cross-fades instead of snapping. */}
          <div className="relative h-7 overflow-hidden">
            <AnimatePresence mode="wait" initial={false}>
              <motion.h2
                key={`${year}-${month}`}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.22, ease: EASE }}
                className="text-lg font-medium tracking-tight tnum"
              >
                {MONTHS[month]}{" "}
                <span className="text-muted-foreground">{year}</span>
              </motion.h2>
            </AnimatePresence>
          </div>

          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                setView(new Date(today.getFullYear(), today.getMonth(), 1))
              }
            >
              Today
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Previous month"
              onClick={() => setView(new Date(year, month - 1, 1))}
            >
              <ChevronLeft />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Next month"
              onClick={() => setView(new Date(year, month + 1, 1))}
            >
              <ChevronRight />
            </Button>
          </div>
        </div>

        {/*
          A month is seven columns or it is not a month, so this scrolls sideways
          rather than reflowing: below about 700px the alternative is 45px cells,
          which hold neither a date nor an event bar. The floor is on a wrapper
          around *both* the weekday strip and the grid so the two scroll as one
          and stay in column.

          It also has to be a width and not a column count. Every event bar is
          positioned with percentages of the seven-column track — `calc(100% /
          span * offset)` for the start hour, `(col + fraction) / 7 * 100%` for
          the now-line — and all of that stays correct under a min-width while
          none of it survives a different number of columns.
        */}
        <div className="overflow-x-auto">
          <div className="min-w-176">
            <div className="grid grid-cols-7 border-b bg-muted/30 text-center text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {WEEKDAYS.map((w) => (
                <div key={w} className="py-2.5">
                  {w}
                </div>
              ))}
            </div>

            <div ref={gridRef}>
              {weeks.map((week, w) => {
                const nowCol = nowColumn(week.days);
                return (
                <div key={`${year}-${month}-w${w}`} className="relative">
                  {/* Day cells: the calendar's clickable base and its borders. */}
                  <div className="grid grid-cols-7">
                    {week.days.map((d, c) => {
                      const today_ = d ? isToday(d) : false;
                      return (
                        <div
                          key={c}
                          data-cell
                          style={{ minHeight: week.minHeight }}
                          className={cn(
                            "group relative border-b border-r p-2 transition-colors nth-[7n]:border-r-0",
                            d ? "cursor-pointer hover:bg-brand/4.5" : "bg-muted/20",
                          )}
                          onClick={
                            d ? () => openCreate(new Date(year, month, d)) : undefined
                          }
                        >
                          {d && (
                            <div className="flex items-center justify-between">
                              <span
                                className={cn(
                                  "inline-flex size-6.5 items-center justify-center rounded-full text-[13px] tnum transition-colors",
                                  today_
                                    ? "bg-brand font-medium text-brand-foreground"
                                    : "text-muted-foreground group-hover:text-foreground",
                                )}
                              >
                                {d}
                              </span>
                              {/* Affordance for click-to-create on an empty day. */}
                              <span className="flex size-5 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
                                <Plus className="size-3.5" />
                              </span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Event bars, laid over the cells so a run can stretch across
                      the days it covers. The layer ignores pointer events; each
                      bar re-enables them for itself. */}
                  <div
                    className="pointer-events-none absolute inset-x-0 grid grid-cols-7 gap-y-1"
                    style={{ top: DATE_ROW, gridAutoRows: `${LANE - 4}px` }}
                  >
                    {week.segments.map((s) => (
                      <Tooltip key={s.e.id}>
                        <TooltipTrigger asChild>
                          <motion.button
                            style={{
                              gridColumn: `${s.colStart + 1} / span ${s.span}`,
                              gridRow: s.lane + 1,
                              // Slide the start-day edge in by the start hour. On a
                              // stretched grid item this eats into the left, so the
                              // right edge stays pinned to the day boundary. A grid
                              // item's % margin is relative to its own area (span
                              // columns), so dividing by the span gives exactly one
                              // column times the fraction, whatever the span.
                              marginLeft: s.offset
                                ? `calc(100% / ${s.span} * ${s.offset} + 2px)`
                                : undefined,
                              // …and pull the end-day edge in by the end hour, so
                              // the right edge lands at the teardown time.
                              marginRight: s.endInset
                                ? `calc(100% / ${s.span} * ${s.endInset} + 2px)`
                                : undefined,
                            }}
                            onClick={(ev) => {
                              ev.stopPropagation();
                              router.push(`/runs/${s.e.id}`);
                            }}
                            whileHover={{ y: -1 }}
                            whileTap={{ scale: 0.99 }}
                            transition={SPRING_SNAPPY}
                            className={cn(
                              // A floor on width keeps a very short (sub-day) run
                              // from collapsing to an unclickable sliver; it simply
                              // overruns its end hour a little when that happens.
                              "pointer-events-auto flex min-w-9 items-center gap-1.5 border px-1.5 text-left text-xs shadow-xs transition-shadow hover:shadow-sm",
                              statusChip(s.e.status),
                              // Round and inset only the true ends; a continuation
                              // runs flush to the edge so it reads as one bar. When
                              // the start is hour-offset, its inline margin above
                              // supersedes the class inset.
                              s.roundLeft ? "ml-0.5 rounded-l-md" : "rounded-l-none",
                              s.roundRight ? "mr-0.5 rounded-r-md" : "rounded-r-none",
                            )}
                          >
                            <span className="relative flex size-1.5 shrink-0">
                              {isActiveStatus(s.e.status) && (
                                <span
                                  className={cn(
                                    "absolute inline-flex size-full animate-ping rounded-full opacity-75",
                                    statusDot(s.e.status),
                                  )}
                                />
                              )}
                              <span
                                className={cn(
                                  "relative inline-flex size-1.5 rounded-full",
                                  statusDot(s.e.status),
                                )}
                              />
                            </span>
                            {s.e.mode === "challenge" && (
                              <Swords
                                className="size-3 shrink-0"
                                aria-label="Challenge"
                              />
                            )}
                            <span className="min-w-0 flex-1 truncate font-medium">
                              {s.e.name}
                              {/* Whose it is, on the all-users view only. */}
                              {s.e.owner && (
                                <span className="font-normal opacity-70">
                                  {" "}
                                  · {s.e.owner}
                                </span>
                              )}
                            </span>
                            {/* On the closing segment, spell out the run's length
                                so "how long" is answerable without opening it. */}
                            {s.roundRight && (
                              <span className="shrink-0 tabular-nums opacity-80">
                                {s.days}d
                              </span>
                            )}
                          </motion.button>
                        </TooltipTrigger>
                        <TooltipContent>{eventTitle(s.e, s.days)}</TooltipContent>
                      </Tooltip>
                    ))}
                  </div>

                  {/* The current moment, drawn across today's cell at the same
                      hour-of-day fraction the bars are inset by — so where it
                      crosses a run is where that run stands right now. Last in the
                      row so it paints over the bars, and inert, so the cell
                      underneath is still click-to-create. */}
                  {nowCol !== null && now && (
                    <div
                      aria-hidden
                      className="pointer-events-none absolute inset-y-0 z-10 w-px bg-brand"
                      style={{
                        left: `calc((${nowCol} + ${dayFraction(now)}) / 7 * 100%)`,
                      }}
                    >
                      <span className="absolute -top-0.5 -left-[2.5px] size-1.5 rounded-full bg-brand" />
                    </div>
                  )}
                </div>
                );
              })}
            </div>
          </div>
        </div>
      </motion.div>

      <CreateEventDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        initialDate={initialDate}
        mode={mode}
      />
    </div>
    </TooltipProvider>
  );
}
