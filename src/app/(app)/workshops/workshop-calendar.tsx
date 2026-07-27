"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import type { RunStatus } from "@/db/schema";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CreateWorkshopDialog } from "./create-workshop-dialog";

type Workshop = { id: string; title: string };
type CalendarEvent = {
  id: string;
  name: string | null;
  status: RunStatus;
  scheduledStart: string | null;
  workshopTitle: string;
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const DOT: Record<RunStatus, string> = {
  scheduled: "bg-violet-500",
  requested: "bg-slate-400",
  provisioning: "bg-blue-500",
  applying: "bg-amber-500",
  ready: "bg-emerald-500",
  destroying: "bg-orange-500",
  destroyed: "bg-slate-300",
  failed: "bg-red-500",
};

const dayKey = (y: number, m: number, d: number) => `${y}-${m}-${d}`;

export function WorkshopCalendar({
  library,
  events,
}: {
  library: Workshop[];
  events: CalendarEvent[];
}) {
  const router = useRouter();
  const today = new Date();
  const [view, setView] = useState(
    () => new Date(today.getFullYear(), today.getMonth(), 1),
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [initialDate, setInitialDate] = useState<Date | null>(null);

  const year = view.getFullYear();
  const month = view.getMonth();

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

  const isToday = (d: number) =>
    d === today.getDate() &&
    month === today.getMonth() &&
    year === today.getFullYear();

  function openCreate(date: Date | null) {
    setInitialDate(date);
    setDialogOpen(true);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Workshops</h1>
          <p className="text-muted-foreground">
            Schedule workshops — each provisions automatically at its start time.
          </p>
        </div>
        <Button onClick={() => openCreate(null)}>
          <Plus /> Create workshop
        </Button>
      </div>

      <div className="rounded-xl border">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-lg font-semibold">
            {MONTHS[month]} {year}
          </h2>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setView(new Date(today.getFullYear(), today.getMonth(), 1))
              }
            >
              Today
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label="Previous month"
              onClick={() => setView(new Date(year, month - 1, 1))}
            >
              <ChevronLeft />
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label="Next month"
              onClick={() => setView(new Date(year, month + 1, 1))}
            >
              <ChevronRight />
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-7 border-b bg-muted/40 text-center text-xs font-medium text-muted-foreground">
          {WEEKDAYS.map((w) => (
            <div key={w} className="py-2">
              {w}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7">
          {cells.map((d, i) => {
            const dayEvents = d
              ? (byDay.get(dayKey(year, month, d)) ?? [])
              : [];
            return (
              <div
                key={i}
                className={cn(
                  "min-h-28 border-b border-r p-1.5 last:border-r-0 [&:nth-child(7n)]:border-r-0",
                  d ? "group cursor-pointer hover:bg-muted/40" : "bg-muted/20",
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
                          "inline-flex h-6 w-6 items-center justify-center rounded-full text-sm",
                          isToday(d)
                            ? "bg-primary font-semibold text-primary-foreground"
                            : "text-muted-foreground",
                        )}
                      >
                        {d}
                      </span>
                      <Plus className="size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                    </div>
                    <div className="mt-1 space-y-1">
                      {dayEvents.map((e) => (
                        <button
                          key={e.id}
                          onClick={(ev) => {
                            ev.stopPropagation();
                            router.push(`/runs/${e.id}`);
                          }}
                          className="flex w-full items-center gap-1.5 rounded bg-card px-1.5 py-1 text-left text-xs shadow-sm ring-1 ring-border hover:bg-accent"
                        >
                          <span
                            className={cn(
                              "size-1.5 shrink-0 rounded-full",
                              DOT[e.status],
                            )}
                          />
                          <span className="truncate">
                            {e.name ?? e.workshopTitle}
                          </span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <CreateWorkshopDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        library={library}
        initialDate={initialDate}
      />
    </div>
  );
}
