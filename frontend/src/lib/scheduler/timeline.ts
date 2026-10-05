/**
 * When a schedule's sessions happen, and what clashes. Each session has its
 * own start, on the quarter hour; the sessions of one track-day never
 * overlap, and the time between them is unscheduled. Day N of every track is
 * the same calendar day, so two sessions clash when they share a day number,
 * overlap in time, and need the same person or the same room. A class and
 * its SE track are taught to the same people, so two sessions on them also
 * clash when both are taught to engineers, or both to sales.
 *
 * Pure, so the schedule page recomputes it as a session is dragged and the
 * server saves by the same rules.
 */

import { SCHEDULE_LIMITS, type ScheduleTrack, type SessionAudience, type SessionKind } from "@/db/schema";

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
  main: "One room",
  breakout: "Multi-room",
  unstructured: "No rooms",
};

export const AUDIENCE_LABELS: Record<SessionAudience, string> = {
  both: "Both",
  sales: "Sales",
  engineers: "Engineers",
};

/** The groups of attendees a session can be taught to; "both" is each of them. */
export type AudienceGroup = Exclude<SessionAudience, "both">;

/** Who is in two sessions at once, as the subject of a sentence. */
export const GROUP_NAMES: Record<AudienceGroup, string> = {
  sales: "Sales attendees",
  engineers: "Engineers",
};

/** Who a new session on `track` is for, until it is changed: engineers on an SE track, both on a class. */
export function defaultAudience(track: ScheduleTrack): SessionAudience {
  return track === "btc_se" || track === "int_se" ? "engineers" : "both";
}

/** The class a track's attendees belong to: an SE track, the class it breaks out of. */
const classOf = (track: ScheduleTrack): ScheduleTrack => (track === "btc_se" ? "btc" : track === "int_se" ? "int" : track);

/** The candidates a track's sessions are taught to, as eVals stages them. */
export function stageOf(track: ScheduleTrack): "bootcamp" | "intermediate" {
  return track === "btc" || track === "btc_se" ? "bootcamp" : "intermediate";
}

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

/** What a day adds up to: when it ends, how much of it to `dayEnd` is unscheduled, and how far past `dayEnd` it runs. */
export type DayTotal = {
  end: number;
  /** Minutes between `dayStart` and `dayEnd` that nothing is scheduled. */
  left: number;
  /** Minutes past `dayEnd`; 0 when it fits. */
  over: number;
};

type Timed = { start: number; minutes: number };

export function dayTotal(sessions: readonly Timed[]): DayTotal {
  const { dayStart, dayEnd } = SCHEDULE_LIMITS;
  const end = Math.max(dayStart, ...sessions.map((s) => s.start + s.minutes));
  const covered = sessions.reduce(
    (sum, s) => sum + Math.max(0, Math.min(dayEnd, s.start + s.minutes) - Math.max(dayStart, s.start)),
    0,
  );
  return { end, left: dayEnd - dayStart - covered, over: Math.max(0, end - dayEnd) };
}

/** The unscheduled stretches of a day: before, between and after its sessions, the last one only as far as `dayEnd`. */
export function gapsOf(sessions: readonly Timed[]): Timed[] {
  const gaps: Timed[] = [];
  let at = SCHEDULE_LIMITS.dayStart;
  for (const s of [...sessions].sort((a, b) => a.start - b.start)) {
    if (s.start > at) gaps.push({ start: at, minutes: s.start - at });
    at = Math.max(at, s.start + s.minutes);
  }
  if (at < SCHEDULE_LIMITS.dayEnd) gaps.push({ start: at, minutes: SCHEDULE_LIMITS.dayEnd - at });
  return gaps;
}

/** Where a session after the last of `sessions` would start: the end of the day's last one, or `dayStart`. */
export function nextStart(sessions: readonly Timed[]): number {
  return Math.max(SCHEDULE_LIMITS.dayStart, ...sessions.map((s) => s.start + s.minutes));
}

/** A start brought to the quarter hour, no earlier than `dayStart`, and early enough to end by midnight. */
export function snapStart(start: number, minutes: number): number {
  const { slot, dayStart, latestEnd } = SCHEDULE_LIMITS;
  return Math.min(latestEnd - minutes, Math.max(dayStart, Math.round(start / slot) * slot));
}

/**
 * The day in start order with nothing overlapping: each session keeps its
 * start unless the one before it runs into it, and is then pushed to that
 * one's end, so a push uses up the unscheduled time before it moves anything
 * further. Session `firstId` goes ahead of any that starts at the same time.
 */
export function settle<S extends Timed & { id: string }>(sessions: readonly S[], firstId?: string): S[] {
  const ordered = [...sessions].sort((a, b) => a.start - b.start || Number(b.id === firstId) - Number(a.id === firstId));
  let at = -Infinity;
  return ordered.map((s) => {
    const start = Math.max(s.start, at);
    at = start + s.minutes;
    return start === s.start ? s : { ...s, start };
  });
}

/**
 * The day with `moved` put at `start`, or as near it as fits. Dropped on the
 * top half of another session, it takes that one's place and pushes it on;
 * on the bottom half, it goes straight after it. Whatever it then runs into
 * is pushed later.
 */
export function dropAt<S extends Timed & { id: string }>(sessions: readonly S[], moved: S, start: number): S[] {
  const rest = sessions.filter((s) => s.id !== moved.id);
  let at = snapStart(start, moved.minutes);
  const under = rest.find((s) => s.start < at && at < s.start + s.minutes);
  if (under) at = at - under.start < under.minutes / 2 ? under.start : under.start + under.minutes;
  return settle([...rest, { ...moved, start: at }], moved.id);
}

/** Whether a day's sessions are each on the quarter hour, inside the day, and clear of one another. */
export function fitsDay(sessions: readonly Timed[]): boolean {
  const { slot, dayStart, latestEnd } = SCHEDULE_LIMITS;
  let at = dayStart;
  for (const s of [...sessions].sort((a, b) => a.start - b.start)) {
    if (s.start % slot !== 0 || s.start < at || s.start + s.minutes > latestEnd) return false;
    at = s.start + s.minutes;
  }
  return true;
}

/** What a session needs to be checked for clashes. */
export type ClashSession = {
  id: string;
  track: ScheduleTrack;
  day: number;
  start: number;
  minutes: number;
  kind: SessionKind;
  audience: SessionAudience;
  name: string;
  roomId: string | null;
  staff: readonly { email: string; fullName: string; roomId: string | null }[];
};

/** The groups a session is taught to. An unstructured one teaches no one, whatever it was saved with. */
export function groupsOf(s: Pick<ClashSession, "kind" | "audience">): AudienceGroup[] {
  if (s.kind === "unstructured") return [];
  return s.audience === "both" ? ["sales", "engineers"] : [s.audience];
}

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

/** A session with its end. */
export type Placed<S extends ClashSession = ClashSession> = S & { end: number };

/** Every session of every track-day in `days`, with its end; anything else about them is kept. */
export function place<S extends ClashSession>(days: readonly (readonly S[])[]): Placed<S>[] {
  return days.flatMap((sessions) => sessions.map((s) => ({ ...s, end: s.start + s.minutes })));
}

/** Why someone or something cannot be in a session: the other one it would be in at the same time. */
export type Clash = {
  sessionId: string;
  name: string;
  track: ScheduleTrack;
  day: number;
  start: number;
  end: number;
  /** The person, room or attendees the two share. */
  what:
    | { kind: "person"; email: string; fullName: string }
    | { kind: "room"; roomId: string }
    | { kind: "audience"; group: AudienceGroup };
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
 * The groups both sessions teach, when they are on a class and its SE track:
 * those attendees cannot be in both. Two on one track-day never overlap.
 */
function sharedGroups(a: Pick<ClashSession, "track" | "kind" | "audience">, b: Pick<ClashSession, "track" | "kind" | "audience">): AudienceGroup[] {
  if (a.track === b.track || classOf(a.track) !== classOf(b.track)) return [];
  const theirs = new Set(groupsOf(b));
  return groupsOf(a).filter((g) => theirs.has(g));
}

/**
 * The clashes of every session that has any, by its id: each other session
 * that overlaps it on the same day and shares a person, a room, or the
 * attendees it is taught to.
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
        for (const group of sharedGroups(a, b)) {
          const what = { kind: "audience" as const, group };
          found.set(a.id, [...(found.get(a.id) ?? []), clashOf(b, what)]);
          found.set(b.id, [...(found.get(b.id) ?? []), clashOf(a, what)]);
        }
      }
    }
  }
  return found;
}

/**
 * The sessions beside `session` on its class or SE track, during `slot`, that
 * teach any of the same attendees. For the session dialog, as its audience,
 * kind or length is changed.
 */
export function audienceClashes(
  placed: readonly Placed[],
  session: Pick<ClashSession, "track" | "kind" | "audience">,
  slot: Slot,
): Clash[] {
  return placed.flatMap((s) =>
    s.id === slot.excludeId || s.day !== slot.day || !overlaps(s, slot)
      ? []
      : sharedGroups(session, s).map((group) => clashOf(s, { kind: "audience", group })),
  );
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
export function describeClash(c: Omit<Clash, "what">): string {
  return `${c.name} · ${TRACK_LABELS[c.track]}, Day ${c.day}, ${formatClock(c.start)}–${formatClock(c.end)}`;
}
