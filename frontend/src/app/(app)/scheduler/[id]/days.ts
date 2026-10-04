/**
 * The schedule page's working copy of a schedule: each track's days, each a
 * list of sessions in start order. Moving a session rewrites its track, day
 * and start so clashes are worked out from where it now is.
 */

import { SCHEDULE_LIMITS, SCHEDULE_TRACKS, type ScheduleTrack } from "@/db/schema";
import type { SessionRow } from "@/lib/scheduler/schedule";
import { dropAt, settle } from "@/lib/scheduler/timeline";

export type Days = Record<ScheduleTrack, SessionRow[][]>;

/** "btc:2": one track-day, as the drag-and-drop containers and the layout save name it. */
export const keyOf = (track: ScheduleTrack, day: number) => `${track}:${day}`;

export function parseKey(key: string): { track: ScheduleTrack; day: number } {
  const [track, day] = key.split(":");
  return { track: track as ScheduleTrack, day: Number(day) };
}

export const dayOf = (days: Days, key: string): SessionRow[] => {
  const { track, day } = parseKey(key);
  return days[track][day - 1] ?? [];
};

/** Every track-day's sessions, for placing in time. */
export const everyDay = (days: Days): SessionRow[][] => SCHEDULE_TRACKS.flatMap((t) => days[t]);

/** The track-day holding a session, and where in it. */
export function locate(days: Days, id: string): { key: string; index: number } | null {
  for (const track of SCHEDULE_TRACKS) {
    for (const [d, sessions] of days[track].entries()) {
      const index = sessions.findIndex((s) => s.id === id);
      if (index >= 0) return { key: keyOf(track, d + 1), index };
    }
  }
  return null;
}

/** `days` with one track-day's sessions replaced. */
export function withDay(days: Days, key: string, sessions: SessionRow[]): Days {
  const { track, day } = parseKey(key);
  const list = [...days[track]];
  list[day - 1] = sessions;
  return { ...days, [track]: list };
}

/**
 * Moves a session to track-day `to`, starting at `start` or as near it as
 * fits; see `dropAt`. Unchanged if `to` is another day and already full.
 */
export function moveTo(days: Days, id: string, to: string, start: number): Days {
  const from = locate(days, id);
  if (!from) return days;
  const source = dayOf(days, from.key);
  const target = from.key === to ? source : dayOf(days, to);
  if (from.key !== to && target.length >= SCHEDULE_LIMITS.sessionsPerDay) return days;
  const { track, day } = parseKey(to);
  const moved = { ...source[from.index]!, track, day };
  const next = from.key === to ? days : withDay(days, from.key, source.filter((_, i) => i !== from.index));
  return withDay(next, to, dropAt(target, moved, start));
}

/** `days` with one session's minutes changed; made longer, it pushes what it runs into later. */
export function resize(days: Days, id: string, minutes: number): Days {
  const at = locate(days, id);
  if (!at) return days;
  const list = dayOf(days, at.key);
  if (list[at.index]!.minutes === minutes) return days;
  return withDay(days, at.key, settle(list.map((s, i) => (i === at.index ? { ...s, minutes } : s)), id));
}
