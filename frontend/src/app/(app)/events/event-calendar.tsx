"use client";

/** The month calendar of scheduled events. */

import { isActiveStatus, statusChip, statusDot } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { CalendarScope, Cloud, EventMode, RunStatus } from "@/db/schema";
import { DAY_SECONDS } from "@/db/schema";
import { EASE, SPRING_SNAPPY } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "framer-motion";
import gsap from "gsap";
import { ChevronLeft, ChevronRight, Plus, Swords } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CreateEventDialog } from "./create-event-dialog";

type CalendarEvent = {
  id: string;
  name: string;
  mode: EventMode;
  status: RunStatus;
  scheduledStart: string | null;
  ttlSeconds: number;
  expiresAt: string | null;
  userCount: number;
  clouds: Cloud[];
  owner: string | null;
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const DAY_MS = 86_400_000;

function dayNum(d: Date): number {
  const midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round(midnight.getTime() / DAY_MS);
}

function dayFraction(d: Date): number {
  return (d.getHours() + d.getMinutes() / 60) / 24;
}

function durationDays(e: CalendarEvent, start: Date): number {
  const seconds = e.expiresAt ? (new Date(e.expiresAt).getTime() - start.getTime()) / 1000 : e.ttlSeconds;
  return Math.max(1, Math.round(seconds / DAY_SECONDS));
}

const NOW_TICK_MS = 60_000;

const DATE_ROW = 34;
const LANE = 26;
const BASE_CELL = 120;

function eventTitle(e: CalendarEvent, days: number): string {
  const span = `${days} day${days === 1 ? "" : "s"}`;
  const starts = e.scheduledStart ? `starts ${new Date(e.scheduledStart).toLocaleString()} · ` : "";
  const ends = e.expiresAt ? `, ends ${new Date(e.expiresAt).toLocaleString()}` : "";
  return `${e.name} · ${starts}runs ${span}${ends}`;
}

export function EventCalendar({
  events,
  scope,
}: {
  events: CalendarEvent[];
  scope: CalendarScope;
}) {
  const router = useRouter();
  const today = new Date();
  const [view, setView] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [dialogOpen, setDialogOpen] = useState(false);
  const [initialDate, setInitialDate] = useState<Date | null>(null);
  const [mode, setMode] = useState<EventMode>("workshop");

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
  const mounted = useRef(false);

  const placed = useMemo(() => {
    const spans = events
      .filter((e) => e.scheduledStart)
      .map((e) => {
        const start = new Date(e.scheduledStart!);
        const startNum = dayNum(start);
        const days = durationDays(e, start);
        const end = e.expiresAt ? new Date(e.expiresAt) : new Date(start.getTime() + e.ttlSeconds * 1000);
        let endNum = dayNum(end);
        let endFraction = dayFraction(end);
        if (endFraction === 0) {
          endNum -= 1;
          endFraction = 1;
        }
        if (endNum < startNum) {
          endNum = startNum;
          endFraction = Math.max(endFraction, dayFraction(start));
        }
        return {
          e,
          startNum,
          endNum,
          days,
          startFraction: dayFraction(start),
          endFraction,
        };
      })
      .sort((a, b) => a.startNum - b.startNum || b.days - a.days);

    const laneEnds: number[] = [];
    const lane = new Map<string, number>();
    for (const s of spans) {
      let l = laneEnds.findIndex((end) => end < s.startNum);
      if (l === -1) l = laneEnds.length;
      laneEnds[l] = s.endNum;
      lane.set(s.e.id, l);
    }
    return { spans, lane };
  }, [events]);

  const cells = useMemo(() => {
    const startWeekday = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const arr: (number | null)[] = [];
    for (let i = 0; i < startWeekday; i++) arr.push(null);
    for (let d = 1; d <= daysInMonth; d++) arr.push(d);
    while (arr.length % 7 !== 0) arr.push(null);
    return arr;
  }, [year, month]);

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
        colStart: number;
        span: number;
        roundLeft: boolean;
        roundRight: boolean;
        days: number;
        offset: number;
        endInset: number;
      }[];
      minHeight: number;
    }[] = [];

    for (let w = 0; w * 7 < cells.length; w++) {
      const days = cells.slice(w * 7, w * 7 + 7);
      const weekLoNum = monthFirstNum + Math.max(1, w * 7 - startWeekday + 1) - 1;
      const weekHiNum = monthFirstNum + Math.min(daysInMonth, w * 7 + 6 - startWeekday + 1) - 1;

      const segments = [];
      for (const s of placed.spans) {
        const clipStart = Math.max(s.startNum, weekLoNum);
        const clipEnd = Math.min(s.endNum, weekHiNum);
        if (clipStart > clipEnd) continue;

        const colStart = startWeekday + (clipStart - monthFirstNum + 1) - 1 - w * 7;
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

  const isToday = (d: number) => d === today.getDate() && month === today.getMonth() && year === today.getFullYear();

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
                ? "Every user's events, including your own."
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
          className="overflow-hidden rounded-2xl border bg-card shadow-sm"
        >
          <div className="flex items-center justify-between border-b px-5 py-4">
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
                  {MONTHS[month]} <span className="text-muted-foreground">{year}</span>
                </motion.h2>
              </AnimatePresence>
            </div>

            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" onClick={() => setView(new Date(today.getFullYear(), today.getMonth(), 1))}>
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
              <Button variant="ghost" size="icon" aria-label="Next month" onClick={() => setView(new Date(year, month + 1, 1))}>
                <ChevronRight />
              </Button>
            </div>
          </div>

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
                              onClick={d ? () => openCreate(new Date(year, month, d)) : undefined}
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
                                  <span className="flex size-5 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
                                    <Plus className="size-3.5" />
                                  </span>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>

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
                                  marginLeft: s.offset ? `calc(100% / ${s.span} * ${s.offset} + 2px)` : undefined,
                                  marginRight: s.endInset ? `calc(100% / ${s.span} * ${s.endInset} + 2px)` : undefined,
                                }}
                                onClick={(ev) => {
                                  ev.stopPropagation();
                                  router.push(`/runs/${s.e.id}`);
                                }}
                                whileHover={{ y: -1 }}
                                whileTap={{ scale: 0.99 }}
                                transition={SPRING_SNAPPY}
                                className={cn(
                                  "pointer-events-auto flex min-w-9 items-center gap-1.5 border px-1.5 text-left text-xs shadow-xs transition-shadow hover:shadow-sm",
                                  statusChip(s.e.status),
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
                                  <span className={cn("relative inline-flex size-1.5 rounded-full", statusDot(s.e.status))} />
                                </span>
                                {s.e.mode === "challenge" && <Swords className="size-3 shrink-0" aria-label="Challenge" />}
                                <span className="min-w-0 flex-1 truncate font-medium">
                                  {s.e.name}
                                  {s.e.owner && <span className="font-normal opacity-70"> · {s.e.owner}</span>}
                                </span>
                                {s.roundRight && <span className="shrink-0 tabular-nums opacity-80">{s.days}d</span>}
                              </motion.button>
                            </TooltipTrigger>
                            <TooltipContent>{eventTitle(s.e, s.days)}</TooltipContent>
                          </Tooltip>
                        ))}
                      </div>

                      {nowCol !== null && now && (
                        <div
                          aria-hidden
                          className="pointer-events-none absolute inset-y-0 z-10 w-px bg-brand"
                          style={{
                            left: `calc((${nowCol} + ${dayFraction(now)}) / 7 * 100%)`,
                          }}
                        >
                          <span className="absolute -top-0.5 left-[-2.5px] size-1.5 rounded-full bg-brand" />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </motion.div>

        <CreateEventDialog open={dialogOpen} onOpenChange={setDialogOpen} initialDate={initialDate} mode={mode} />
      </div>
    </TooltipProvider>
  );
}
