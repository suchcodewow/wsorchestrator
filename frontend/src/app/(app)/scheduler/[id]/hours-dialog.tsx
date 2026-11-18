"use client";

/**
 * Who is assigned how many hours of content across every session of every day
 * of the schedule, as a bar per person, busiest first.
 */

import { useMemo } from "react";
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { SessionRow } from "@/lib/scheduler/schedule";

export type StaffHours = {
  email: string;
  name: string;
  minutes: number;
  sessions: number;
  /** Minutes spent leading a session. */
  leading: number;
  /** Minutes spent as a judge in a breakout. */
  judging: number;
};

export function staffHours(sessions: SessionRow[]): StaffHours[] {
  const byEmail = new Map<string, StaffHours>();
  for (const s of sessions) {
    for (const p of s.staff) {
      const row = byEmail.get(p.email) ?? { email: p.email, name: p.fullName, minutes: 0, sessions: 0, leading: 0, judging: 0 };
      row.minutes += s.minutes;
      row.sessions += 1;
      if (s.kind === "breakout") row.judging += s.minutes;
      else if (p.leader) row.leading += s.minutes;
      byEmail.set(p.email, row);
    }
  }
  return [...byEmail.values()].sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name));
}

const hours = (minutes: number) => `${Math.round((minutes / 60) * 10) / 10} h`;

export function HoursDialog({
  open,
  onOpenChange,
  sessions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessions: SessionRow[];
}) {
  const rows = useMemo(() => staffHours(sessions), [sessions]);
  const most = rows[0]?.minutes ?? 1;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Hours assigned</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="mb-3 flex gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full bg-green-500" />
              Leading
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full bg-blue-500" />
              Judging
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full border bg-white" />
              Assisting
            </span>
          </div>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nobody is assigned to a session yet.</p>
          ) : (
            <ul className="space-y-2">
              {rows.map((r) => (
                <li
                  key={r.email}
                  className="grid grid-cols-[10rem_1fr_4.5rem] items-center gap-3 text-sm"
                  title={`${r.sessions} sessions: ${hours(r.leading)} leading, ${hours(r.judging)} judging`}
                >
                  <span className="truncate">{r.name}</span>
                  <span className="h-4 rounded-full bg-muted">
                    <span
                      className="flex h-full overflow-hidden rounded-full border bg-white"
                      style={{ width: `${(r.minutes / most) * 100}%` }}
                    >
                      <span className="h-full bg-green-500" style={{ width: `${(r.leading / r.minutes) * 100}%` }} />
                      <span className="h-full bg-blue-500" style={{ width: `${(r.judging / r.minutes) * 100}%` }} />
                    </span>
                  </span>
                  <span className="text-right tabular-nums">{hours(r.minutes)}</span>
                </li>
              ))}
            </ul>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
