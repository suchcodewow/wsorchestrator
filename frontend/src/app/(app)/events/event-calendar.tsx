"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import gsap from "gsap";
import { ChevronLeft, ChevronRight, Plus, Swords } from "lucide-react";
import type { CalendarScope, Cloud, EventMode, RunStatus } from "@/db/schema";
import { Button } from "@/components/ui/button";
import { statusDot, isActiveStatus } from "@/components/status-badge";
import { cn } from "@/lib/utils";
import { EASE, SPRING_SNAPPY } from "@/lib/motion";
import { CreateEventDialog } from "./create-event-dialog";

type CalendarEvent = {
  id: string;
  name: string;
  mode: EventMode;
  status: RunStatus;
  scheduledStart: string | null;
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

const dayKey = (y: number, m: number, d: number) => `${y}-${m}-${d}`;

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

  const year = view.getFullYear();
  const month = view.getMonth();
  const gridRef = useRef<HTMLDivElement>(null);
  // Skips the entrance animation on first paint, so arriving at the page is
  // not the same event as deliberately changing month.
  const mounted = useRef(false);

  // Group events by the local day they start on.
  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of events) {
      if (!e.scheduledStart) continue;
      const d = new Date(e.scheduledStart);
      const key = dayKey(d.getFullYear(), d.getMonth(), d.getDate());
      (map.get(key) ?? map.set(key, []).get(key)!).push(e);
    }
    return map;
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

        <div className="grid grid-cols-7 border-b bg-muted/30 text-center text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {WEEKDAYS.map((w) => (
            <div key={w} className="py-2.5">
              {w}
            </div>
          ))}
        </div>

        <div ref={gridRef} className="grid grid-cols-7">
          {cells.map((d, i) => {
            const dayEvents = d
              ? (byDay.get(dayKey(year, month, d)) ?? [])
              : [];
            const today_ = d ? isToday(d) : false;

            return (
              <div
                key={`${year}-${month}-${i}`}
                data-cell
                className={cn(
                  "group relative min-h-30 border-b border-r p-2 transition-colors nth-[7n]:border-r-0",
                  d
                    ? "cursor-pointer hover:bg-brand/4.5"
                    : "bg-muted/20",
                )}
                onClick={
                  d ? () => openCreate(new Date(year, month, d)) : undefined
                }
              >
                {d && (
                  <>
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
                      {/* Affordance for the click-to-create on an empty day. */}
                      <span className="flex size-5 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
                        <Plus className="size-3.5" />
                      </span>
                    </div>

                    <div className="mt-1.5 space-y-1">
                      {dayEvents.map((e) => (
                        <motion.button
                          key={e.id}
                          onClick={(ev) => {
                            ev.stopPropagation();
                            router.push(`/runs/${e.id}`);
                          }}
                          whileHover={{ y: -1, scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                          transition={SPRING_SNAPPY}
                          className="flex w-full items-center gap-1.5 rounded-lg border bg-card px-1.5 py-1 text-left text-xs shadow-xs hover:border-brand-border hover:shadow-sm"
                        >
                          <span className="relative flex size-1.5 shrink-0">
                            {isActiveStatus(e.status) && (
                              <span
                                className={cn(
                                  "absolute inline-flex size-full animate-ping rounded-full opacity-75",
                                  statusDot(e.status),
                                )}
                              />
                            )}
                            <span
                              className={cn(
                                "relative inline-flex size-1.5 rounded-full",
                                statusDot(e.status),
                              )}
                            />
                          </span>
                          {e.mode === "challenge" && (
                            <Swords
                              className="size-3 shrink-0 text-brand"
                              aria-label="Challenge"
                            />
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium">
                              {e.name}
                            </span>
                            {/* Whose it is, on the all-users view only. */}
                            {e.owner && (
                              <span className="block truncate text-[10px] leading-tight text-muted-foreground">
                                {e.owner}
                              </span>
                            )}
                          </span>
                          <span className="shrink-0 text-muted-foreground tnum">
                            {e.userCount}
                          </span>
                        </motion.button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </motion.div>

      <CreateEventDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        initialDate={initialDate}
        mode={mode}
      />
    </div>
  );
}
