/**
 * "Upcoming Sessions": every bootcamp not yet over, soonest first, with its
 * dates and whether it holds an intermediate class. Shown to everyone.
 */

import { CalendarDays } from "lucide-react";
import type { UpcomingBootcamp } from "@/lib/scheduler/bootcamps";

const RANGE = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

/** Two `YYYY-MM-DD` days as "Nov 9 – 12, 2026", or one as "Nov 9, 2026". */
function formatRange(start: string, end: string): string {
  const from = new Date(`${start}T00:00:00Z`);
  return start === end ? RANGE.format(from) : RANGE.formatRange(from, new Date(`${end}T00:00:00Z`));
}

export function UpcomingSessions({ sessions }: { sessions: UpcomingBootcamp[] }) {
  return (
    <section aria-labelledby="welcome-upcoming" className="max-w-3xl overflow-hidden rounded-2xl border bg-card shadow-sm">
      <div className="flex items-center gap-2.5 px-5 py-4">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand ring-1 ring-brand/15">
          <CalendarDays className="size-4" />
        </span>
        <h2 id="welcome-upcoming" className="text-base font-medium">
          Upcoming Sessions
        </h2>
      </div>
      {sessions.length === 0 ? (
        <p className="border-t px-5 py-4 text-sm text-muted-foreground">No sessions are scheduled.</p>
      ) : (
        <ul className="divide-y border-t">
          {sessions.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-3 text-sm">
              <span className="font-medium tnum">{formatRange(s.startDate, s.endDate)}</span>
              <span className="text-muted-foreground">{s.intDays === null ? "Bootcamp" : "Bootcamp and Intermediate"}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
