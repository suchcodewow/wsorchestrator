/**
 * The schedule page's working copy of a schedule: each track's days, each a
 * list of sessions in order. Moving a session rewrites its track and day so
 * clashes are worked out from where it now is.
 */

import { SCHEDULE_LIMITS, SCHEDULE_TRACKS, type ScheduleTrack } from "@/db/schema";
import type { SessionRow } from "@/lib/scheduler/schedule";

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

/** Moves a session to `to` at `index`, or last; unchanged if `to` is full. */
export function moveTo(days: Days, id: string, to: string, index: number | null): Days {
  const from = locate(days, id);
  if (!from) return days;
  if (from.key === to) {
    const list = [...dayOf(days, to)];
    const [item] = list.splice(from.index, 1);
    list.splice(Math.min(index ?? list.length, list.length), 0, item!);
    return withDay(days, to, list);
  }
  const target = dayOf(days, to);
  if (target.length >= SCHEDULE_LIMITS.sessionsPerDay) return days;
  const source = dayOf(days, from.key);
  const { track, day } = parseKey(to);
  const moved = { ...source[from.index]!, track, day };
  const next = withDay(days, from.key, source.filter((_, i) => i !== from.index));
  const list = [...target];
  list.splice(Math.min(index ?? list.length, list.length), 0, moved);
  return withDay(next, to, list);
}

/** `days` with one session's minutes changed. */
export function resize(days: Days, id: string, minutes: number): Days {
  const at = locate(days, id);
  if (!at) return days;
  const list = dayOf(days, at.key);
  if (list[at.index]!.minutes === minutes) return days;
  return withDay(days, at.key, list.map((s, i) => (i === at.index ? { ...s, minutes } : s)));
}
