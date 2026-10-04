/**
 * One bootcamp's schedule: four tracks of days, each day a list of sessions
 * in order. A session has no start time; see `timeline.ts`. Read a track-day
 * at a time, so no query fetches more than `SCHEDULE_LIMITS.sessionsPerDay`.
 *
 * Who can run a session is the bootcamp's instructors: every Training
 * administrator and every guest judge of that bootcamp. Adding someone, or a
 * room, that is busy elsewhere at the time is refused as a clash. Moving or
 * resizing sessions is not: it saves, and the schedule shows what now clashes
 * in red, since a day is often rearranged through a clash on the way to a
 * plan that has none.
 */

import "server-only";

import { and, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  BOOTCAMP_LIMITS,
  EVALS_SLACK_CONTACT_LIMITS,
  SCHEDULE_LIMITS,
  SCHEDULE_TRACKS,
  bootcamps,
  employees,
  facilities,
  facilityRooms,
  scheduleSessionComments,
  scheduleSessionStaff,
  scheduleSessions,
  users,
  type BootcampStatus,
  type ScheduleTrack,
  type SessionColor,
  type SessionKind,
} from "@/db/schema";
import { noteAudit } from "@/lib/audit-context";
import { normalEmail } from "@/lib/evals/history-values";
import { roomsOf as facilityRoomsOf, type RoomRow } from "@/lib/scheduler/facilities";
import { judgePicks } from "@/lib/scheduler/judges";
import { isForeignKeyViolation } from "@/lib/scheduler/pg-errors";
import { allSessionTypes, sessionLookSchema } from "@/lib/scheduler/session-types";
import {
  IMPORT_TYPES,
  SheetImportError,
  parseScheduleSheet,
  type ImportPerson,
  type ImportType,
} from "@/lib/scheduler/sheet-import";
import { TRACK_LABELS, busyDuring, place, startsOf, trackDays, type Clash } from "@/lib/scheduler/timeline";
import { readSpreadsheet } from "@/lib/spreadsheet-file";

export type StaffRow = {
  email: string;
  fullName: string;
  leader: boolean;
  /** A breakout instructor's room; null in any other kind of session. */
  roomId: string | null;
};

export type SessionRow = {
  id: string;
  track: ScheduleTrack;
  day: number;
  position: number;
  minutes: number;
  kind: SessionKind;
  typeId: string | null;
  name: string;
  description: string;
  emoji: string;
  color: SessionColor;
  roomId: string | null;
  /** The leader first, then the other instructors in order. */
  staff: StaffRow[];
  comments: number;
  updatedAt: Date;
};

export type ScheduleBootcamp = {
  id: string;
  startDate: string;
  btcDays: number;
  intDays: number | null;
  status: BootcampStatus;
  facilityId: string | null;
  facilityName: string | null;
};

export type Instructor = {
  email: string;
  fullName: string;
  /** A Training administrator, or only a guest judge of this bootcamp. */
  role: "administrator" | "judge";
};

export type Schedule = {
  bootcamp: ScheduleBootcamp;
  /** The facility's rooms, in order; none before a facility is picked. */
  rooms: RoomRow[];
  instructors: Instructor[];
  /** Each track's days, in order: `days[track][d]` is day d + 1. A track the bootcamp does not hold has none. */
  days: Record<ScheduleTrack, SessionRow[][]>;
};

// Spelled out, because Drizzle leaves the table off a column in a one-table
// query, and an unqualified `id` inside these would mean the staff row's own.
const staffJson = sql<StaffRow[]>`coalesce((
  select json_agg(json_build_object(
    'email', st.email, 'fullName', st.full_name, 'leader', st.leader, 'roomId', st.room_id
  ) order by st.leader desc, st.position, st.email)
  from ${scheduleSessionStaff} st where st.session_id = ${scheduleSessions}.id
), '[]'::json)`;

const commentCount = sql<number>`(select count(*)::int from ${scheduleSessionComments} c where c.session_id = ${scheduleSessions}.id)`;

const SESSION_COLUMNS = {
  id: scheduleSessions.id,
  track: scheduleSessions.track,
  day: scheduleSessions.day,
  position: scheduleSessions.position,
  minutes: scheduleSessions.minutes,
  kind: scheduleSessions.kind,
  typeId: scheduleSessions.typeId,
  name: scheduleSessions.name,
  description: scheduleSessions.description,
  emoji: scheduleSessions.emoji,
  color: scheduleSessions.color,
  roomId: scheduleSessions.roomId,
  staff: staffJson,
  comments: commentCount,
  updatedAt: scheduleSessions.updatedAt,
};

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = Pick<typeof db, "select">;

/** One track-day's sessions in order. */
async function loadDay(reader: Reader, bootcampId: string, track: ScheduleTrack, day: number): Promise<SessionRow[]> {
  return reader
    .select(SESSION_COLUMNS)
    .from(scheduleSessions)
    .where(and(eq(scheduleSessions.bootcampId, bootcampId), eq(scheduleSessions.track, track), eq(scheduleSessions.day, day)))
    .orderBy(scheduleSessions.position, scheduleSessions.createdAt, scheduleSessions.id)
    .limit(SCHEDULE_LIMITS.sessionsPerDay);
}

/** Day `day` of every track the bootcamp holds then, each in order, for checking clashes. */
async function loadDayAcrossTracks(reader: Reader, bootcamp: ScheduleBootcamp, day: number): Promise<SessionRow[][]> {
  const tracks = SCHEDULE_TRACKS.filter((t) => (trackDays(t, bootcamp) ?? 0) >= day);
  return Promise.all(tracks.map((t) => loadDay(reader, bootcamp.id, t, day)));
}

export async function scheduleBootcamp(id: string): Promise<ScheduleBootcamp | null> {
  const [row] = await db
    .select({
      id: bootcamps.id,
      startDate: bootcamps.startDate,
      btcDays: bootcamps.btcDays,
      intDays: bootcamps.intDays,
      status: bootcamps.status,
      facilityId: bootcamps.facilityId,
      facilityName: facilities.name,
    })
    .from(bootcamps)
    .leftJoin(facilities, eq(facilities.id, bootcamps.facilityId))
    .where(eq(bootcamps.id, id));
  return row ?? null;
}

/** Everyone who can run a session at this bootcamp: Training administrators, then its guest judges. */
export async function instructorPool(bootcampId: string): Promise<Instructor[]> {
  const [admins, judges] = await Promise.all([
    db
      .select({ email: sql<string>`lower(${users.email})`, name: users.name })
      .from(users)
      .where(and(sql`${users.email} is not null`, or(eq(users.trainingRole, "administrator"), eq(users.isPlatformAdmin, true))))
      .orderBy(sql`lower(coalesce(nullif(${users.name}, ''), ${users.email}))`)
      .limit(100),
    judgePicks(bootcampId),
  ]);
  const pool = new Map<string, Instructor>();
  for (const a of admins) pool.set(a.email, { email: a.email, fullName: a.name || a.email, role: "administrator" });
  for (const j of judges) {
    if (!pool.has(j.email)) pool.set(j.email, { email: j.email, fullName: j.fullName || j.email, role: "judge" });
  }
  return [...pool.values()];
}

/** The whole schedule, as the schedule page draws it. */
export async function loadSchedule(bootcampId: string): Promise<Schedule | null> {
  const bootcamp = await scheduleBootcamp(bootcampId);
  if (!bootcamp) return null;
  const perTrack = SCHEDULE_TRACKS.map((track) => {
    const count = trackDays(track, bootcamp) ?? 0;
    return Promise.all(Array.from({ length: count }, (_, d) => loadDay(db, bootcampId, track, d + 1)));
  });
  const [rooms, instructors, ...days] = await Promise.all([
    bootcamp.facilityId ? facilityRoomsOf(bootcamp.facilityId) : Promise.resolve([]),
    instructorPool(bootcampId),
    ...perTrack,
  ]);
  return {
    bootcamp,
    rooms,
    instructors,
    days: Object.fromEntries(SCHEDULE_TRACKS.map((t, i) => [t, days[i]!])) as Record<ScheduleTrack, SessionRow[][]>,
  };
}

/** One session of a bootcamp, or null. */
export async function getSession(bootcampId: string, sessionId: string): Promise<SessionRow | null> {
  const [row] = await db
    .select(SESSION_COLUMNS)
    .from(scheduleSessions)
    .where(and(eq(scheduleSessions.id, sessionId), eq(scheduleSessions.bootcampId, bootcampId)));
  return row ?? null;
}

/** Whether the session belongs to the bootcamp. */
export async function sessionOf(bootcampId: string, sessionId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: scheduleSessions.id })
    .from(scheduleSessions)
    .where(and(eq(scheduleSessions.id, sessionId), eq(scheduleSessions.bootcampId, bootcampId)));
  return Boolean(row);
}

// ─── Clashes ────────────────────────────────────────────────────────────────

/** What each person and room is doing on `day` from `start` for `minutes`, leaving out session `excludeId`. */
export async function availability(
  bootcamp: ScheduleBootcamp,
  slot: { day: number; start: number; minutes: number; excludeId?: string },
): Promise<{ people: Record<string, Clash[]>; rooms: Record<string, Clash[]> }> {
  const placed = place(await loadDayAcrossTracks(db, bootcamp, slot.day));
  const busy = busyDuring(placed, { day: slot.day, start: slot.start, end: slot.start + slot.minutes, excludeId: slot.excludeId });
  return { people: Object.fromEntries(busy.people), rooms: Object.fromEntries(busy.rooms) };
}

/** The clashes of one session as it stands, against the rest of its day. */
export async function clashesOf(bootcamp: ScheduleBootcamp, session: SessionRow): Promise<Clash[]> {
  const placed = place(await loadDayAcrossTracks(db, bootcamp, session.day));
  const self = placed.find((s) => s.id === session.id);
  if (!self) return [];
  const busy = busyDuring(placed, { day: self.day, start: self.start, end: self.end, excludeId: self.id });
  const mine = new Set([...(self.kind === "unstructured" ? [] : self.staff.map((p) => p.email))]);
  const rooms = new Set(self.kind === "main" ? [self.roomId] : self.kind === "breakout" ? self.staff.map((p) => p.roomId) : []);
  return [
    ...[...busy.people].filter(([email]) => mine.has(email)).flatMap(([, c]) => c),
    ...[...busy.rooms].filter(([room]) => rooms.has(room)).flatMap(([, c]) => c),
  ];
}

// ─── Editing a session ──────────────────────────────────────────────────────

const staffSchema = z.object({
  email: z.string().max(EVALS_SLACK_CONTACT_LIMITS.email),
  leader: z.boolean().default(false),
  /** In a breakout, the room this instructor takes; ignored in any other kind. */
  roomId: z.string().uuid().nullable().optional(),
});

const sessionFields = {
  ...sessionLookSchema,
  emoji: sessionLookSchema.emoji.default(""),
  color: sessionLookSchema.color.default("slate"),
  description: sessionLookSchema.description.default(""),
  /** The session type it was started from, if any. */
  typeId: z.string().uuid().nullable().default(null),
  /** A main session's room. */
  roomId: z.string().uuid().nullable().default(null),
  /** The leader and the other instructors: exactly one marked leader when there are any. */
  staff: z.array(staffSchema).max(SCHEDULE_LIMITS.staff).default([]),
};

export const sessionInputSchema = z.object({
  track: z.enum(SCHEDULE_TRACKS),
  day: z.number().int().min(1).max(BOOTCAMP_LIMITS.maxDays),
  /** Where in the day, from 0; left out, it goes last. */
  position: z.number().int().min(0).max(SCHEDULE_LIMITS.sessionsPerDay).optional(),
  ...sessionFields,
});

/** An edit changes only the fields it names. Moving it to another time is the layout's job. */
export const sessionPatchSchema = z.object({
  kind: sessionLookSchema.kind,
  name: sessionLookSchema.name,
  emoji: sessionLookSchema.emoji,
  color: sessionLookSchema.color,
  minutes: sessionLookSchema.minutes,
  description: sessionLookSchema.description,
  typeId: z.string().uuid().nullable(),
  roomId: z.string().uuid().nullable(),
  staff: z.array(staffSchema).max(SCHEDULE_LIMITS.staff),
}).partial();

export type SessionError =
  | "invalid"
  | "not_found"
  | "no_day"
  | "day_full"
  | "no_leader"
  | "not_instructor"
  | "unknown_room"
  | "shared_room"
  | "unknown_type"
  | "clash";

export const SESSION_STATUS_FOR: Record<SessionError, number> = {
  invalid: 400,
  not_found: 404,
  no_day: 400,
  day_full: 409,
  no_leader: 400,
  not_instructor: 400,
  unknown_room: 400,
  shared_room: 400,
  unknown_type: 400,
  clash: 409,
};

export type SessionFailure = {
  ok: false;
  error: SessionError;
  /** For `not_instructor`: who is not one. */
  email?: string;
  /** For `clash`: what the new people or rooms are doing then. */
  clashes?: Clash[];
};

type Staffing = { kind: SessionKind; roomId: string | null; staff: StaffRow[] };

/**
 * The people and rooms a session of `kind` keeps from what was asked: an
 * unstructured one keeps none, a main one has no rooms on its staff, and a
 * breakout has no room of its own. Names come from the pool, or from the
 * session as it was for someone kept who has since left it.
 */
function staffing(
  kind: SessionKind,
  roomId: string | null,
  staff: z.infer<typeof staffSchema>[],
  names: Map<string, string>,
): Staffing | SessionFailure {
  if (kind === "unstructured") return { kind, roomId: null, staff: [] };
  const seen = new Set<string>();
  const out: StaffRow[] = [];
  for (const s of staff) {
    const email = normalEmail(s.email);
    if (!email) return { ok: false, error: "invalid" };
    if (seen.has(email)) continue;
    seen.add(email);
    out.push({ email, fullName: names.get(email) ?? email, leader: s.leader, roomId: kind === "breakout" ? (s.roomId ?? null) : null });
  }
  if (out.length > 0 && out.filter((s) => s.leader).length !== 1) return { ok: false, error: "no_leader" };
  if (kind === "breakout") {
    const rooms = out.flatMap((s) => (s.roomId ? [s.roomId] : []));
    if (new Set(rooms).size !== rooms.length) return { ok: false, error: "shared_room" };
  }
  out.sort((a, b) => Number(b.leader) - Number(a.leader));
  return { kind, roomId: kind === "main" ? roomId : null, staff: out };
}

const roomIdsOf = (s: Staffing) => (s.kind === "main" ? (s.roomId ? [s.roomId] : []) : s.staff.flatMap((p) => (p.roomId ? [p.roomId] : [])));

/** Whether every room is one of the bootcamp's facility's. */
async function roomsKnown(bootcamp: ScheduleBootcamp, ids: string[]): Promise<boolean> {
  if (ids.length === 0) return true;
  if (!bootcamp.facilityId) return false;
  const found = await db
    .select({ id: facilityRooms.id })
    .from(facilityRooms)
    .where(and(eq(facilityRooms.facilityId, bootcamp.facilityId), inArray(facilityRooms.id, [...new Set(ids)])));
  return found.length === new Set(ids).size;
}

/**
 * Refuses the people and rooms that are new to the session — not in `before` —
 * when they are busy elsewhere during `slot`.
 */
async function newClashes(
  bootcamp: ScheduleBootcamp,
  slot: { day: number; start: number; minutes: number; excludeId?: string },
  next: Staffing,
  before: Staffing | null,
): Promise<SessionFailure | null> {
  const oldPeople = new Set(before && before.kind !== "unstructured" ? before.staff.map((s) => s.email) : []);
  const oldRooms = new Set(before ? roomIdsOf(before) : []);
  const people = next.staff.map((s) => s.email).filter((e) => !oldPeople.has(e));
  const rooms = roomIdsOf(next).filter((r) => !oldRooms.has(r));
  if (people.length === 0 && rooms.length === 0) return null;
  const busy = await availability(bootcamp, slot);
  const clashes = [...people.flatMap((e) => busy.people[e] ?? []), ...rooms.flatMap((r) => busy.rooms[r] ?? [])];
  return clashes.length > 0 ? { ok: false, error: "clash", clashes } : null;
}

async function writeStaff(tx: Tx, sessionId: string, staff: StaffRow[]): Promise<void> {
  await tx.delete(scheduleSessionStaff).where(eq(scheduleSessionStaff.sessionId, sessionId));
  if (staff.length === 0) return;
  await tx.insert(scheduleSessionStaff).values(staff.map((s, position) => ({ sessionId, ...s, position })));
}

const label = (bootcamp: ScheduleBootcamp, s: { name: string; track: ScheduleTrack; day: number }) =>
  `${s.name} (bootcamp starting ${bootcamp.startDate}, ${s.track} day ${s.day})`;

/** Adds a session to a track-day, at `position` or last; the sessions after it move along. */
export async function createSession(
  actorId: string,
  bootcampId: string,
  input: z.infer<typeof sessionInputSchema>,
): Promise<{ ok: true; session: SessionRow } | SessionFailure> {
  const bootcamp = await scheduleBootcamp(bootcampId);
  if (!bootcamp) return { ok: false, error: "not_found" };
  if (input.day > (trackDays(input.track, bootcamp) ?? 0)) return { ok: false, error: "no_day" };

  const pool = await instructorPool(bootcampId);
  const names = new Map(pool.map((p) => [p.email, p.fullName]));
  const next = staffing(input.kind, input.roomId, input.staff, names);
  if ("ok" in next) return next;
  const outsider = next.staff.find((s) => !names.has(s.email));
  if (outsider) return { ok: false, error: "not_instructor", email: outsider.email };
  if (!(await roomsKnown(bootcamp, roomIdsOf(next)))) return { ok: false, error: "unknown_room" };

  const day = await loadDay(db, bootcampId, input.track, input.day);
  if (day.length >= SCHEDULE_LIMITS.sessionsPerDay) return { ok: false, error: "day_full" };
  const position = Math.min(input.position ?? day.length, day.length);
  const start = SCHEDULE_LIMITS.dayStart + day.slice(0, position).reduce((sum, s) => sum + s.minutes, 0);
  const clash = await newClashes(bootcamp, { day: input.day, start, minutes: input.minutes }, next, null);
  if (clash) return clash;

  let id: string;
  try {
    id = await db.transaction(async (tx) => {
      await tx
        .update(scheduleSessions)
        .set({ position: sql`${scheduleSessions.position} + 1` })
        .where(
          and(
            eq(scheduleSessions.bootcampId, bootcampId),
            eq(scheduleSessions.track, input.track),
            eq(scheduleSessions.day, input.day),
            sql`${scheduleSessions.position} >= ${position}`,
          ),
        );
      const [made] = await tx
        .insert(scheduleSessions)
        .values({
          bootcampId,
          track: input.track,
          day: input.day,
          position,
          minutes: input.minutes,
          kind: next.kind,
          typeId: input.typeId,
          name: input.name,
          description: input.description,
          emoji: input.emoji,
          color: input.color,
          roomId: next.roomId,
          createdBy: actorId,
        })
        .returning({ id: scheduleSessions.id });
      await writeStaff(tx, made!.id, next.staff);
      return made!.id;
    });
  } catch (err) {
    // A type or room removed in between.
    if (isForeignKeyViolation(err)) return { ok: false, error: input.typeId ? "unknown_type" : "unknown_room" };
    throw err;
  }
  noteAudit({ target: id, targetLabel: label(bootcamp, input) });
  return { ok: true, session: (await getSession(bootcampId, id))! };
}

export async function updateSession(
  bootcampId: string,
  sessionId: string,
  patch: z.infer<typeof sessionPatchSchema>,
): Promise<{ ok: true; session: SessionRow } | SessionFailure> {
  const bootcamp = await scheduleBootcamp(bootcampId);
  const before = bootcamp ? await getSession(bootcampId, sessionId) : null;
  if (!bootcamp || !before) return { ok: false, error: "not_found" };
  noteAudit({ target: sessionId, targetLabel: label(bootcamp, { ...before, name: patch.name ?? before.name }) });

  const pool = await instructorPool(bootcampId);
  const names = new Map([...before.staff.map((s) => [s.email, s.fullName] as const), ...pool.map((p) => [p.email, p.fullName] as const)]);
  const kind = patch.kind ?? before.kind;
  const next = staffing(kind, patch.roomId !== undefined ? patch.roomId : before.roomId, patch.staff ?? before.staff, names);
  if ("ok" in next) return next;
  // Someone already on it stays even if no longer an instructor; anyone added must be one.
  const kept = new Set(before.staff.map((s) => s.email));
  const poolEmails = new Set(pool.map((p) => p.email));
  const outsider = next.staff.find((s) => !kept.has(s.email) && !poolEmails.has(s.email));
  if (outsider) return { ok: false, error: "not_instructor", email: outsider.email };
  const oldRooms = new Set(roomIdsOf(before));
  if (!(await roomsKnown(bootcamp, roomIdsOf(next).filter((r) => !oldRooms.has(r))))) return { ok: false, error: "unknown_room" };

  const day = await loadDay(db, bootcampId, before.track, before.day);
  const start = startsOf(day)[day.findIndex((s) => s.id === sessionId)] ?? SCHEDULE_LIMITS.dayStart;
  const clash = await newClashes(
    bootcamp,
    { day: before.day, start, minutes: patch.minutes ?? before.minutes, excludeId: sessionId },
    next,
    before,
  );
  if (clash) return clash;

  // Kind, room and staff come from `next`, which settled them together.
  const { name, emoji, color, minutes, description, typeId } = patch;
  const fields = { name, emoji, color, minutes, description, typeId };
  try {
    await db.transaction(async (tx) => {
      await tx
        .update(scheduleSessions)
        .set({ ...fields, kind: next.kind, roomId: next.roomId, updatedAt: new Date() })
        .where(eq(scheduleSessions.id, sessionId));
      const sameStaff = JSON.stringify(next.staff) === JSON.stringify(before.staff);
      if (!sameStaff) await writeStaff(tx, sessionId, next.staff);
    });
  } catch (err) {
    if (isForeignKeyViolation(err)) return { ok: false, error: patch.typeId ? "unknown_type" : "unknown_room" };
    throw err;
  }
  return { ok: true, session: (await getSession(bootcampId, sessionId))! };
}

/** Removes a session; the rest of its day moves up to fill the time. */
export async function deleteSession(bootcampId: string, sessionId: string): Promise<{ ok: true } | { ok: false; error: "not_found" }> {
  const bootcamp = await scheduleBootcamp(bootcampId);
  if (!bootcamp) return { ok: false, error: "not_found" };
  const deleted = await db.transaction(async (tx) => {
    const [row] = await tx
      .delete(scheduleSessions)
      .where(and(eq(scheduleSessions.id, sessionId), eq(scheduleSessions.bootcampId, bootcampId)))
      .returning({ name: scheduleSessions.name, track: scheduleSessions.track, day: scheduleSessions.day, position: scheduleSessions.position });
    if (!row) return null;
    await tx
      .update(scheduleSessions)
      .set({ position: sql`${scheduleSessions.position} - 1` })
      .where(
        and(
          eq(scheduleSessions.bootcampId, bootcampId),
          eq(scheduleSessions.track, row.track),
          eq(scheduleSessions.day, row.day),
          sql`${scheduleSessions.position} > ${row.position}`,
        ),
      );
    return row;
  });
  if (!deleted) return { ok: false, error: "not_found" };
  noteAudit({ target: sessionId, targetLabel: label(bootcamp, deleted) });
  return { ok: true };
}

// ─── Rearranging ────────────────────────────────────────────────────────────

export const layoutSchema = z.object({
  /** Each track-day that changed, with every session it now holds, in order. */
  days: z
    .array(
      z.object({
        track: z.enum(SCHEDULE_TRACKS),
        day: z.number().int().min(1).max(BOOTCAMP_LIMITS.maxDays),
        sessions: z
          .array(z.object({ id: z.string().uuid(), minutes: sessionLookSchema.minutes }))
          .max(SCHEDULE_LIMITS.sessionsPerDay),
      }),
    )
    .min(1)
    .max(SCHEDULE_TRACKS.length * BOOTCAMP_LIMITS.maxDays),
});

export type LayoutError = "invalid" | "not_found" | "no_day" | "stale";

export const LAYOUT_STATUS_FOR: Record<LayoutError, number> = { invalid: 400, not_found: 404, no_day: 400, stale: 409 };

/**
 * Saves the order and length of every session on the track-days named. A
 * session moved between days is listed in its new day, and the day it left
 * must be listed too. Refused as `stale` unless the sessions named are
 * exactly the ones those days hold now, so two people rearranging at once
 * cannot lose or duplicate one.
 */
export async function saveLayout(
  bootcampId: string,
  input: z.infer<typeof layoutSchema>,
): Promise<{ ok: true } | { ok: false; error: LayoutError }> {
  const bootcamp = await scheduleBootcamp(bootcampId);
  if (!bootcamp) return { ok: false, error: "not_found" };
  noteAudit({ target: bootcampId, targetLabel: `Schedule of the bootcamp starting ${bootcamp.startDate}` });

  const keys = input.days.map((d) => `${d.track}:${d.day}`);
  if (new Set(keys).size !== keys.length) return { ok: false, error: "invalid" };
  if (input.days.some((d) => d.day > (trackDays(d.track, bootcamp) ?? 0))) return { ok: false, error: "no_day" };
  const ids = input.days.flatMap((d) => d.sessions.map((s) => s.id));
  if (new Set(ids).size !== ids.length) return { ok: false, error: "invalid" };

  try {
    await db.transaction(async (tx) => {
      // Locks the days' sessions, so a second save waits for this one and then finds it stale.
      const now = await Promise.all(
        input.days.map((d) =>
          tx
            .select({ id: scheduleSessions.id })
            .from(scheduleSessions)
            .where(and(eq(scheduleSessions.bootcampId, bootcampId), eq(scheduleSessions.track, d.track), eq(scheduleSessions.day, d.day)))
            .limit(SCHEDULE_LIMITS.sessionsPerDay + 1)
            .for("update"),
        ),
      );
      const held = new Set(now.flat().map((r) => r.id));
      if (held.size !== ids.length || ids.some((id) => !held.has(id))) throw new Stale();
      if (ids.length === 0) return;
      const rows = input.days.flatMap((d) =>
        d.sessions.map((s, position) => sql`(${s.id}::uuid, ${d.track}, ${d.day}::int, ${position}::int, ${s.minutes}::int)`),
      );
      await tx.execute(sql`
        update ${scheduleSessions} s
        set track = v.track, day = v.day, position = v.position, minutes = v.minutes, updated_at = now()
        from (values ${sql.join(rows, sql`, `)}) as v(id, track, day, position, minutes)
        where s.id = v.id and s.bootcamp_id = ${bootcampId}
      `);
    });
  } catch (err) {
    if (err instanceof Stale) return { ok: false, error: "stale" };
    throw err;
  }
  return { ok: true };
}

class Stale extends Error {}

// ─── Filling a schedule from another ────────────────────────────────────────

/** A session to write, with its people. */
type NewSession = {
  track: ScheduleTrack;
  day: number;
  position: number;
  minutes: number;
  kind: SessionKind;
  typeId: string | null;
  name: string;
  description: string;
  emoji: string;
  color: SessionColor;
  roomId: string | null;
  staff: StaffRow[];
};

export type FillError = "not_found" | "has_sessions" | "same_bootcamp" | "no_file" | "too_large" | "unreadable" | "not_schedule";

export const FILL_STATUS_FOR: Record<FillError, number> = {
  not_found: 404,
  has_sessions: 409,
  same_bootcamp: 400,
  no_file: 400,
  too_large: 413,
  unreadable: 400,
  not_schedule: 400,
};

export type FillSummary = { sessions: number; notes: string[] };

async function hasSessions(bootcampId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: scheduleSessions.id })
    .from(scheduleSessions)
    .where(eq(scheduleSessions.bootcampId, bootcampId))
    .limit(1);
  return Boolean(row);
}

const INSERT_BATCH = 100;

/** Replaces every session of the bootcamp with `sessions`. */
async function writeSchedule(actorId: string, bootcampId: string, sessions: NewSession[]): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(scheduleSessions).where(eq(scheduleSessions.bootcampId, bootcampId));
    for (let i = 0; i < sessions.length; i += INSERT_BATCH) {
      const batch = sessions.slice(i, i + INSERT_BATCH);
      const made = await tx
        .insert(scheduleSessions)
        .values(batch.map((s) => ({ ...s, staff: undefined, bootcampId, createdBy: actorId })))
        .returning({ id: scheduleSessions.id });
      const staff = batch.flatMap((s, j) => s.staff.map((p, position) => ({ sessionId: made[j]!.id, ...p, position })));
      if (staff.length > 0) await tx.insert(scheduleSessionStaff).values(staff);
    }
  });
}

/** "Ana Ruiz, Ben Ode and 2 more". */
function someNames(names: string[]): string {
  const shown = names.slice(0, 5).join(", ");
  return names.length > 5 ? `${shown} and ${names.length - 5} more` : shown;
}

/** A note naming who was kept on sessions though not an instructor of this bootcamp. */
function outsiderNote(sessions: NewSession[], pool: Instructor[]): string | null {
  const inPool = new Set(pool.map((p) => p.email));
  const outside = new Map<string, string>();
  for (const s of sessions) for (const p of s.staff) if (!inPool.has(p.email)) outside.set(p.email, p.fullName);
  if (outside.size === 0) return null;
  return `Kept ${outside.size} ${outside.size === 1 ? "person who is" : "people who are"} not a Training administrator or a guest judge of this bootcamp: ${someNames([...outside.values()])}.`;
}

/**
 * Makes the bootcamp's schedule a copy of `sourceId`'s: every session and who
 * runs it, without comments. Rooms come too when both are at the same
 * facility. Days the bootcamp does not run are left out and said so.
 * Refused as `has_sessions` if it has a schedule already, unless `replace`.
 */
export async function copySchedule(
  actorId: string,
  bootcampId: string,
  sourceId: string,
  replace: boolean,
): Promise<{ ok: true; summary: FillSummary } | { ok: false; error: FillError }> {
  if (sourceId === bootcampId) return { ok: false, error: "same_bootcamp" };
  const [target, source] = await Promise.all([scheduleBootcamp(bootcampId), scheduleBootcamp(sourceId)]);
  if (!target || !source) return { ok: false, error: "not_found" };
  noteAudit({ target: bootcampId, targetLabel: `Schedule of the bootcamp starting ${target.startDate}, from ${source.startDate}` });
  if (!replace && (await hasSessions(bootcampId))) return { ok: false, error: "has_sessions" };

  const keepRooms = Boolean(target.facilityId) && target.facilityId === source.facilityId;
  const notes: string[] = [];
  const sessions: NewSession[] = [];
  let hadRooms = false;
  for (const track of SCHEDULE_TRACKS) {
    const from = trackDays(track, source) ?? 0;
    const to = trackDays(track, target) ?? 0;
    const days = await Promise.all(Array.from({ length: Math.min(from, to) }, (_, d) => loadDay(db, sourceId, track, d + 1)));
    for (const day of days) {
      for (const [position, s] of day.entries()) {
        if (s.roomId || s.staff.some((p) => p.roomId)) hadRooms = true;
        sessions.push({
          track: s.track,
          day: s.day,
          position,
          minutes: s.minutes,
          kind: s.kind,
          typeId: s.typeId,
          name: s.name,
          description: s.description,
          emoji: s.emoji,
          color: s.color,
          roomId: keepRooms ? s.roomId : null,
          staff: s.staff.map((p) => ({ ...p, roomId: keepRooms ? p.roomId : null })),
        });
      }
    }
    if (from > to) {
      notes.push(
        to === 0
          ? `Left out ${from} day${from === 1 ? "" : "s"} of ${TRACK_LABELS[track]}: this bootcamp does not hold it.`
          : `Left out ${TRACK_LABELS[track]} days ${to + 1}–${from}: this bootcamp runs it ${to} day${to === 1 ? "" : "s"}.`,
      );
    }
  }
  if (hadRooms && !keepRooms) notes.push("Rooms were left off: the two bootcamps are not at the same facility.");
  const outsiders = outsiderNote(sessions, await instructorPool(bootcampId));
  if (outsiders) notes.push(outsiders);

  await writeSchedule(actorId, bootcampId, sessions);
  return { ok: true, summary: { sessions: sessions.length, notes } };
}

/** At most this many distinct Team names are looked up in the employee list. */
const MAX_NAMES = 2000;

/** Employees by lowercased full name, for the names given, a hundred at a time. */
async function employeesNamed(names: string[]): Promise<Map<string, ImportPerson>> {
  const found = new Map<string, ImportPerson>();
  const wanted = [...new Set(names.map((n) => n.trim().toLowerCase()).filter((n) => n.length > 0 && n.length <= 200))].slice(0, MAX_NAMES);
  for (let i = 0; i < wanted.length; i += 100) {
    const rows = await db
      .select({ name: sql<string>`lower(${employees.fullName})`, fullName: employees.fullName, email: sql<string>`lower(${employees.email})` })
      .from(employees)
      .where(inArray(sql`lower(${employees.fullName})`, wanted.slice(i, i + 100)))
      .limit(100);
    for (const r of rows) if (!found.has(r.name)) found.set(r.name, { email: r.email, fullName: r.fullName });
  }
  return found;
}

/**
 * Who a Team name is: an instructor with that full name, an employee with it,
 * or the one instructor with that first name. Otherwise nobody.
 */
function nameResolver(pool: Instructor[], employeesByName: Map<string, ImportPerson>) {
  const byName = new Map(pool.map((p) => [p.fullName.toLowerCase(), p]));
  const byFirst = new Map<string, Instructor | null>();
  for (const p of pool) {
    const first = p.fullName.split(/\s+/)[0]!.toLowerCase();
    byFirst.set(first, byFirst.has(first) ? null : p);
  }
  return (raw: string): ImportPerson | null => {
    const name = raw.trim().toLowerCase();
    if (!name) return null;
    const hit = byName.get(name) ?? employeesByName.get(name) ?? (/\s/.test(name) ? null : byFirst.get(name));
    return hit ? { email: hit.email, fullName: hit.fullName } : null;
  };
}

/**
 * Makes the bootcamp's schedule the one in an uploaded copy of the Google
 * Sheet's Schedule tab, as `.xlsx` (its first sheet) or `.csv`. Refused as
 * `has_sessions` if it has a schedule already, unless `replace`.
 */
export async function importSchedule(
  actorId: string,
  bootcampId: string,
  file: File | null,
  replace: boolean,
): Promise<{ ok: true; summary: FillSummary } | { ok: false; error: FillError }> {
  const bootcamp = await scheduleBootcamp(bootcampId);
  if (!bootcamp) return { ok: false, error: "not_found" };
  noteAudit({ target: bootcampId, targetLabel: `Schedule of the bootcamp starting ${bootcamp.startDate}, imported` });
  if (!file || file.size === 0) return { ok: false, error: "no_file" };
  if (file.size > SCHEDULE_LIMITS.importBytes) return { ok: false, error: "too_large" };
  if (!replace && (await hasSessions(bootcampId))) return { ok: false, error: "has_sessions" };

  let rows;
  try {
    rows = readSpreadsheet(Buffer.from(await file.arrayBuffer())).rows;
  } catch {
    return { ok: false, error: "unreadable" };
  }
  const days = Object.fromEntries(SCHEDULE_TRACKS.map((t) => [t, trackDays(t, bootcamp)])) as Record<ScheduleTrack, number | null>;

  let parsed;
  try {
    // Once to learn every name the Team columns hold, then again knowing who they are.
    const asked: string[] = [];
    parseScheduleSheet(rows, { days, resolve: (name) => (asked.push(name), null) });
    const [pool, byName] = await Promise.all([instructorPool(bootcampId), employeesNamed(asked)]);
    parsed = { pool, ...parseScheduleSheet(rows, { days, resolve: nameResolver(pool, byName) }) };
  } catch (err) {
    if (err instanceof SheetImportError) return { ok: false, error: err.code };
    throw err;
  }

  const types = new Map((await allSessionTypes()).map((t) => [t.name.toLowerCase(), t]));
  const look = (type: ImportType) => {
    const fallback = IMPORT_TYPES[type];
    const row = types.get(fallback.name.toLowerCase());
    return row && row.kind === fallback.kind
      ? { typeId: row.id, emoji: row.emoji, color: row.color, kind: row.kind }
      : { typeId: null, emoji: fallback.emoji, color: fallback.color, kind: fallback.kind };
  };
  const sessions: NewSession[] = parsed.sessions.map((s) => {
    const { typeId, emoji, color, kind } = look(s.type);
    return {
      track: s.track,
      day: s.day,
      position: s.position,
      minutes: s.minutes,
      kind,
      typeId,
      name: s.name,
      description: s.description,
      emoji,
      color,
      roomId: null,
      staff: kind === "unstructured" ? [] : s.staff.map((p, i) => ({ ...p, leader: i === 0, roomId: null })),
    };
  });

  const notes = [...parsed.notes];
  const outsiders = outsiderNote(sessions, parsed.pool);
  if (outsiders) notes.push(outsiders);
  const leaderless = sessions.filter((s) => s.kind !== "unstructured" && s.staff.length === 0).length;
  if (leaderless > 0) notes.push(`${leaderless} session${leaderless === 1 ? " has" : "s have"} no leader yet.`);

  await writeSchedule(actorId, bootcampId, sessions);
  return { ok: true, summary: { sessions: sessions.length, notes } };
}

export type CopySource = { id: string; startDate: string; sessions: number };

/** The latest bootcamps with a schedule to start from, leaving out `bootcampId`; null for a bootcamp not yet made. */
export async function copySources(bootcampId: string | null): Promise<CopySource[]> {
  const count = sql<number>`(select count(*)::int from ${scheduleSessions} s where s.bootcamp_id = ${bootcamps}.id)`;
  return db
    .select({ id: bootcamps.id, startDate: bootcamps.startDate, sessions: count })
    .from(bootcamps)
    .where(and(bootcampId ? sql`${bootcamps}.id <> ${bootcampId}` : undefined, sql`${count} > 0`))
    .orderBy(sql`${bootcamps.startDate} desc`)
    .limit(20);
}
