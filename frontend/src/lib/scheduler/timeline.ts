/**
 * When a schedule's sessions happen, and what clashes. A session has no start
 * time of its own: each day of each track begins at `dayStart`, and every
 * session starts where the one before it ends. Day N of every track is the
 * same calendar day, so two sessions clash when they share a day number,
 * overlap in time, and need the same person or the same room.
 *
 * Pure, so the schedule page recomputes it as a session is dragged and the
 * availability route answers from the same rules.
 */

import { SCHEDULE_LIMITS, type ScheduleTrack, type SessionKind } from "@/db/schema";

export const TRACK_LABELS: Record<ScheduleTrack, string> = {
  btc: "Bootcamp",
  int: "Intermediate",
  btc_se: "SE Bootcamp",
  int_se: "SE Intermediate",
};

export const KIND_LABELS: Record<SessionKind, string> = {
  main: "Main",
  breakout: "Breakout",
  unstructured: "Unstructured",
};

export const KIND_HINTS: Record<SessionKind, string> = {
  main: "One leader, any other instructors, one room",
  breakout: "One leader and other instructors, a room for each",
  unstructured: "No instructors and no room",
};

/** How many days a track runs: the SE tracks follow the class they break out of. Null when the bootcamp has no such class. */
export function trackDays(track: ScheduleTrack, bootcamp: { btcDays: number; intDays: number | null }): number | null {
  return track === "btc" || track === "btc_se" ? bootcamp.btcDays : bootcamp.intDays;
}

/** "8:00 AM", for minutes after midnight. */
export function formatClock(minute: number): string {
  const h24 = Math.floor(minute / 60) % 24;
  const m = minute % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${h24 < 12 ? "AM" : "PM"}`;
}

/** "1h 30m", "45m", "2h". */
export function formatLength(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** `minutes` brought to a whole number of slots, at least one and at most the longest a session may be. */
export function snapMinutes(minutes: number): number {
  const { slot, maxMinutes } = SCHEDULE_LIMITS;
  return Math.min(maxMinutes, Math.max(slot, Math.round(minutes / slot) * slot));
}

/** The calendar date of day `day` of a bootcamp starting `startDate`, as YYYY-MM-DD. */
export function dayDate(startDate: string, day: number): string {
  const d = new Date(`${startDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + day - 1);
  return d.toISOString().slice(0, 10);
}

/** What a day adds up to: when it ends, and how far that is from the end of the day. */
export type DayTotal = {
  end: number;
  /** Minutes before `dayEnd` that nothing is scheduled; 0 when over. */
  left: number;
  /** Minutes past `dayEnd`; 0 when it fits. */
  over: number;
};

export function dayTotal(sessions: readonly { minutes: number }[]): DayTotal {
  const end = SCHEDULE_LIMITS.dayStart + sessions.reduce((sum, s) => sum + s.minutes, 0);
  return {
    end,
    left: Math.max(0, SCHEDULE_LIMITS.dayEnd - end),
    over: Math.max(0, end - SCHEDULE_LIMITS.dayEnd),
  };
}

/** The start of each session, in order: `dayStart`, then each one's start plus its minutes. */
export function startsOf(sessions: readonly { minutes: number }[]): number[] {
  const starts: number[] = [];
  let at = SCHEDULE_LIMITS.dayStart;
  for (const s of sessions) {
    starts.push(at);
    at += s.minutes;
  }
  return starts;
}

/** What a session needs to be checked for clashes. */
export type ClashSession = {
  id: string;
  track: ScheduleTrack;
  day: number;
  minutes: number;
  kind: SessionKind;
  name: string;
  roomId: string | null;
  staff: readonly { email: string; fullName: string; roomId: string | null }[];
};

/** The emails a session takes up. An unstructured one takes none, whatever it was saved with. */
export function peopleOf(s: Pick<ClashSession, "kind" | "staff">): string[] {
  return s.kind === "unstructured" ? [] : s.staff.map((p) => p.email);
}

/** The rooms a session takes up: a main session's one, or each breakout instructor's. */
export function roomsOf(s: Pick<ClashSession, "kind" | "roomId" | "staff">): string[] {
  if (s.kind === "main") return s.roomId ? [s.roomId] : [];
  if (s.kind === "breakout") return s.staff.flatMap((p) => (p.roomId ? [p.roomId] : []));
  return [];
}

/** A session placed in time. */
export type Placed<S extends ClashSession = ClashSession> = S & { start: number; end: number };

/**
 * Every session with its start and end. `days` is each track-day's sessions
 * in order; anything else about them is kept.
 */
export function place<S extends ClashSession>(days: readonly (readonly S[])[]): Placed<S>[] {
  return days.flatMap((sessions) => {
    const starts = startsOf(sessions);
    return sessions.map((s, i) => ({ ...s, start: starts[i]!, end: starts[i]! + s.minutes }));
  });
}

/** Why someone or something cannot be in a session: the other one it would be in at the same time. */
export type Clash = {
  sessionId: string;
  name: string;
  track: ScheduleTrack;
  day: number;
  start: number;
  end: number;
  /** The person or room the two share. */
  what: { kind: "person"; email: string; fullName: string } | { kind: "room"; roomId: string };
};

const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) =>
  a.start < b.end && b.start < a.end;

function clashOf(other: Placed, what: Clash["what"]): Clash {
  return {
    sessionId: other.id,
    name: other.name,
    track: other.track,
    day: other.day,
    start: other.start,
    end: other.end,
    what,
  };
}

/**
 * The clashes of every session that has any, by its id: each other session
 * that overlaps it on the same day and shares a person or a room.
 */
export function findClashes(placed: readonly Placed[]): Map<string, Clash[]> {
  const byDay = new Map<number, Placed[]>();
  for (const s of placed) byDay.set(s.day, [...(byDay.get(s.day) ?? []), s]);

  const found = new Map<string, Clash[]>();
  for (const sessions of byDay.values()) {
    for (let i = 0; i < sessions.length; i++) {
      for (let j = i + 1; j < sessions.length; j++) {
        const a = sessions[i]!;
        const b = sessions[j]!;
        if (!overlaps(a, b)) continue;
        const bPeople = new Set(peopleOf(b));
        const bRooms = new Set(roomsOf(b));
        for (const p of a.staff) {
          if (!peopleOf(a).includes(p.email) || !bPeople.has(p.email)) continue;
          const what = { kind: "person" as const, email: p.email, fullName: p.fullName };
          found.set(a.id, [...(found.get(a.id) ?? []), clashOf(b, what)]);
          found.set(b.id, [...(found.get(b.id) ?? []), clashOf(a, what)]);
        }
        for (const roomId of new Set(roomsOf(a))) {
          if (!bRooms.has(roomId)) continue;
          const what = { kind: "room" as const, roomId };
          found.set(a.id, [...(found.get(a.id) ?? []), clashOf(b, what)]);
          found.set(b.id, [...(found.get(b.id) ?? []), clashOf(a, what)]);
        }
      }
    }
  }
  return found;
}

/** A time a session would take: day, start and end, leaving out the session itself if it is one being edited. */
export type Slot = { day: number; start: number; end: number; excludeId?: string };

/** What each person and each room is already doing during `slot`, keyed by email and by room id. */
export function busyDuring(
  placed: readonly Placed[],
  slot: Slot,
): { people: Map<string, Clash[]>; rooms: Map<string, Clash[]> } {
  const people = new Map<string, Clash[]>();
  const rooms = new Map<string, Clash[]>();
  for (const s of placed) {
    if (s.id === slot.excludeId || s.day !== slot.day || !overlaps(s, slot)) continue;
    for (const p of s.staff) {
      if (!peopleOf(s).includes(p.email)) continue;
      people.set(p.email, [...(people.get(p.email) ?? []), clashOf(s, { kind: "person", email: p.email, fullName: p.fullName })]);
    }
    for (const roomId of new Set(roomsOf(s))) {
      rooms.set(roomId, [...(rooms.get(roomId) ?? []), clashOf(s, { kind: "room", roomId })]);
    }
  }
  return { people, rooms };
}

/** "Command of the Message · Bootcamp, Day 2, 12:00 PM–2:00 PM". */
export function describeClash(c: Clash): string {
  return `${c.name} · ${TRACK_LABELS[c.track]}, Day ${c.day}, ${formatClock(c.start)}–${formatClock(c.end)}`;
}
