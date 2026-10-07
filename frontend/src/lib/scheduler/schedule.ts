/**
 * One bootcamp's schedule: four tracks of days, each day a list of sessions
 * in start order, none overlapping; see `timeline.ts`. Read a track-day
 * at a time, so no query fetches more than `SCHEDULE_LIMITS.sessionsPerDay`.
 *
 * Who can run a session is the bootcamp's instructors: every Training
 * administrator and every guest judge of that bootcamp. Adding someone, or a
 * room, that is busy elsewhere at the time is refused as a clash. Moving or
 * resizing sessions is not, nor is pushing the ones after a session later to
 * make room for it: it saves, and the schedule shows what now clashes
 * in red, since a day is often rearranged through a clash on the way to a
 * plan that has none.
 */

import "server-only";

import { and, eq, inArray, notInArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  AUDIENCE_TRACKS,
  BOOTCAMP_LIMITS,
  CHECKLIST_LIMITS,
  CHECKLIST_PREP_DAY,
  EVALS_SLACK_CONTACT_LIMITS,
  SCHEDULE_LIMITS,
  SCHEDULE_TRACKS,
  bootcamps,
  employees,
  evalsAssessments,
  facilities,
  facilityRooms,
  mentions,
  scheduleChecklistItems,
  scheduleSessionComments,
  scheduleSessionGroups,
  scheduleSessionStaff,
  scheduleSessions,
  users,
  type BootcampStatus,
  type ChecklistPeriod,
  type EvalsAssessmentStage,
  SESSION_AUDIENCES,
  type ScheduleTrack,
  type SessionAudience,
  type SessionColor,
  type SessionKind,
} from "@/db/schema";
import { noteAudit } from "@/lib/audit-context";
import { normalEmail } from "@/lib/evals/history-values";
import { taggerOf } from "@/lib/mention-store";
import { classLists, type ClassLists } from "@/lib/scheduler/attendees";
import { roomsOf as facilityRoomsOf, type RoomRow } from "@/lib/scheduler/facilities";
import { judgePicks } from "@/lib/scheduler/judges";
import { isForeignKeyViolation } from "@/lib/scheduler/pg-errors";
import { sessionLookSchema } from "@/lib/scheduler/session-types";
import {
  TRACK_LABELS,
  audienceClashes,
  busyDuring,
  defaultAudience,
  dropAt,
  fitsDay,
  nextStart,
  place,
  settle,
  stageOf,
  trackDays,
  type Clash,
} from "@/lib/scheduler/timeline";

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
  /** Minutes after midnight. */
  start: number;
  minutes: number;
  kind: SessionKind;
  /** Who it is taught to; an unstructured session teaches no one, whatever this says. */
  audience: SessionAudience;
  typeId: string | null;
  name: string;
  description: string;
  emoji: string;
  color: SessionColor;
  roomId: string | null;
  /** The assessment a breakout's groups are scored on; null on any other kind. */
  assessmentId: string | null;
  /** The leader first, then the other instructors in order. */
  staff: StaffRow[];
  comments: number;
  /** The most attendees any one instructor's breakout group holds; 0 when nobody is assigned. */
  largestGroup: number;
  /** Everyone in its breakout groups, by email. */
  assigned: string[];
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

/** An assessment a breakout can be scored on. */
export type BreakoutAssessment = { id: string; name: string; stage: EvalsAssessmentStage; active: boolean };

export type Schedule = {
  bootcamp: ScheduleBootcamp;
  /** The facility's rooms, in order; none before a facility is picked. */
  rooms: RoomRow[];
  instructors: Instructor[];
  /** Every active assessment, and any inactive one a breakout here still names. */
  assessments: BreakoutAssessment[];
  /** Each track's days, in order: `days[track][d]` is day d + 1. A track the bootcamp does not hold has none. */
  days: Record<ScheduleTrack, SessionRow[][]>;
  /** Who each class is now, so a breakout can say who it has left out. */
  classes: ClassLists;
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

const largestGroup = sql<number>`coalesce((
  select max(n) from (
    select count(*)::int n from ${scheduleSessionGroups} g where g.session_id = ${scheduleSessions}.id group by g.instructor_email
  ) sizes
), 0)`;

const assignedJson = sql<string[]>`coalesce((
  select json_agg(g.email order by g.email) from ${scheduleSessionGroups} g where g.session_id = ${scheduleSessions}.id
), '[]'::json)`;

const SESSION_COLUMNS = {
  id: scheduleSessions.id,
  track: scheduleSessions.track,
  day: scheduleSessions.day,
  start: scheduleSessions.start,
  minutes: scheduleSessions.minutes,
  kind: scheduleSessions.kind,
  audience: scheduleSessions.audience,
  typeId: scheduleSessions.typeId,
  name: scheduleSessions.name,
  description: scheduleSessions.description,
  emoji: scheduleSessions.emoji,
  color: scheduleSessions.color,
  roomId: scheduleSessions.roomId,
  assessmentId: scheduleSessions.assessmentId,
  staff: staffJson,
  comments: commentCount,
  largestGroup,
  assigned: assignedJson,
  updatedAt: scheduleSessions.updatedAt,
};

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = Pick<typeof db, "select">;

/** One track-day's sessions in start order. */
async function loadDay(reader: Reader, bootcampId: string, track: ScheduleTrack, day: number): Promise<SessionRow[]> {
  return reader
    .select(SESSION_COLUMNS)
    .from(scheduleSessions)
    .where(and(eq(scheduleSessions.bootcampId, bootcampId), eq(scheduleSessions.track, track), eq(scheduleSessions.day, day)))
    .orderBy(scheduleSessions.start, scheduleSessions.createdAt, scheduleSessions.id)
    .limit(SCHEDULE_LIMITS.sessionsPerDay);
}

/** Day `day` of every track the bootcamp holds then, for checking clashes. */
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

async function breakoutAssessments(bootcampId: string): Promise<BreakoutAssessment[]> {
  const a = evalsAssessments;
  const named = sql`${a.id} in (select s.assessment_id from ${scheduleSessions} s where s.bootcamp_id = ${bootcampId})`;
  return db
    .select({ id: a.id, name: a.name, stage: a.stage, active: a.active })
    .from(a)
    .where(or(eq(a.active, true), named))
    .orderBy(sql`lower(${a.name})`, a.id)
    .limit(100);
}

/** A breakout that names no assessment, so nobody finds its groups under Assigned to me. */
export type UnassignedBreakout = {
  id: string;
  name: string;
  track: ScheduleTrack;
  day: number;
  start: number;
  bootcampId: string;
  bootcampStartDate: string;
  bootcampStatus: BootcampStatus;
};

/**
 * The breakouts at bootcamps still to run, or running now, that name no
 * assessment: the first 100 by bootcamp, then track, day and start, and how
 * many there are in all.
 */
export async function unassignedBreakouts(): Promise<{ rows: UnassignedBreakout[]; total: number }> {
  const s = scheduleSessions;
  const where = and(eq(s.kind, "breakout"), sql`${s.assessmentId} is null`, inArray(bootcamps.status, ["scheduled", "active"]));
  const [rows, [count]] = await Promise.all([
    db
      .select({
        id: s.id,
        name: s.name,
        track: s.track,
        day: s.day,
        start: s.start,
        bootcampId: s.bootcampId,
        bootcampStartDate: bootcamps.startDate,
        bootcampStatus: bootcamps.status,
      })
      .from(s)
      .innerJoin(bootcamps, eq(bootcamps.id, s.bootcampId))
      .where(where)
      .orderBy(bootcamps.startDate, bootcamps.id, s.track, s.day, s.start, s.id)
      .limit(100),
    db.select({ total: sql<number>`count(*)::int` }).from(s).innerJoin(bootcamps, eq(bootcamps.id, s.bootcampId)).where(where),
  ]);
  return { rows, total: count?.total ?? 0 };
}

/** The whole schedule, as the schedule page draws it. */
export async function loadSchedule(bootcampId: string): Promise<Schedule | null> {
  const bootcamp = await scheduleBootcamp(bootcampId);
  if (!bootcamp) return null;
  const perTrack = SCHEDULE_TRACKS.map((track) => {
    const count = trackDays(track, bootcamp) ?? 0;
    return Promise.all(Array.from({ length: count }, (_, d) => loadDay(db, bootcampId, track, d + 1)));
  });
  const [rooms, instructors, assessments, classes, ...days] = await Promise.all([
    bootcamp.facilityId ? facilityRoomsOf(bootcamp.facilityId) : Promise.resolve([]),
    instructorPool(bootcampId),
    breakoutAssessments(bootcampId),
    classLists(bootcamp.intDays !== null),
    ...perTrack,
  ]);
  return {
    bootcamp,
    rooms,
    instructors,
    assessments,
    days: Object.fromEntries(SCHEDULE_TRACKS.map((t, i) => [t, days[i]!])) as Record<ScheduleTrack, SessionRow[][]>,
    classes,
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
    ...audienceClashes(placed, self, { day: self.day, start: self.start, end: self.end, excludeId: self.id }),
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
  /** Left out, engineers on an SE track and both on a class. */
  audience: z.enum(SESSION_AUDIENCES).optional(),
  /** The session type it was started from, if any. */
  typeId: z.string().uuid().nullable().default(null),
  /** A main session's room. */
  roomId: z.string().uuid().nullable().default(null),
  /** A breakout's assessment, of its track's stage; ignored in any other kind. */
  assessmentId: z.string().uuid().nullable().default(null),
  /** The leader and the other instructors: exactly one marked leader when there are any. */
  staff: z.array(staffSchema).max(SCHEDULE_LIMITS.staff).default([]),
};

export const sessionInputSchema = z.object({
  track: z.enum(SCHEDULE_TRACKS),
  day: z.number().int().min(1).max(BOOTCAMP_LIMITS.maxDays),
  /** Minutes after midnight; left out, straight after the day's last session. */
  start: z.number().int().min(SCHEDULE_LIMITS.dayStart).max(SCHEDULE_LIMITS.latestEnd - SCHEDULE_LIMITS.slot).optional(),
  ...sessionFields,
});

/** An edit changes only the fields it names. Moving it to another time or day is the layout's job. */
export const sessionPatchSchema = z.object({
  kind: sessionLookSchema.kind,
  audience: z.enum(SESSION_AUDIENCES),
  name: sessionLookSchema.name,
  emoji: sessionLookSchema.emoji,
  color: sessionLookSchema.color,
  minutes: sessionLookSchema.minutes,
  description: sessionLookSchema.description,
  typeId: z.string().uuid().nullable(),
  roomId: z.string().uuid().nullable(),
  assessmentId: z.string().uuid().nullable(),
  staff: z.array(staffSchema).max(SCHEDULE_LIMITS.staff),
}).partial();

export type SessionError =
  | "invalid"
  | "not_found"
  | "no_day"
  | "day_full"
  | "past_midnight"
  | "no_leader"
  | "not_instructor"
  | "unknown_room"
  | "shared_room"
  | "unknown_type"
  | "unknown_assessment"
  | "clash";

export const SESSION_STATUS_FOR: Record<SessionError, number> = {
  invalid: 400,
  not_found: 404,
  no_day: 400,
  day_full: 409,
  past_midnight: 409,
  no_leader: 400,
  not_instructor: 400,
  unknown_room: 400,
  shared_room: 400,
  unknown_type: 400,
  unknown_assessment: 400,
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

/** Whether the assessment exists and scores the candidates `track` is taught to. */
async function assessmentFits(track: ScheduleTrack, id: string): Promise<boolean> {
  const [row] = await db.select({ stage: evalsAssessments.stage }).from(evalsAssessments).where(eq(evalsAssessments.id, id));
  return row?.stage === stageOf(track);
}

/** What a foreign key refused: something named here that was removed in between. */
const missing = (asked: { typeId?: string | null; assessmentId?: string | null }): SessionError =>
  asked.typeId ? "unknown_type" : asked.assessmentId ? "unknown_assessment" : "unknown_room";

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

/**
 * Drops the breakout groups a session can no longer keep: every one unless it
 * is a breakout, else those of anyone off its staff, and anyone on a track its
 * audience no longer takes in.
 */
async function pruneGroups(tx: Tx, sessionId: string, next: Staffing, audience: SessionAudience): Promise<void> {
  const kept = next.kind === "breakout" ? next.staff.map((s) => s.email) : [];
  const untaught = (["sales", "engineer"] as const).filter((t) => !AUDIENCE_TRACKS[audience].includes(t));
  const g = scheduleSessionGroups;
  await tx
    .delete(g)
    .where(
      and(
        eq(g.sessionId, sessionId),
        kept.length > 0
          ? or(
              notInArray(g.instructorEmail, kept),
              untaught.length > 0 ? inArray(g.email, tx.select({ email: employees.email }).from(employees).where(inArray(employees.track, untaught))) : undefined,
            )
          : undefined,
      ),
    );
}

async function writeStaff(tx: Tx, sessionId: string, staff: StaffRow[]): Promise<void> {
  await tx.delete(scheduleSessionStaff).where(eq(scheduleSessionStaff.sessionId, sessionId));
  if (staff.length === 0) return;
  await tx.insert(scheduleSessionStaff).values(staff.map((s, position) => ({ sessionId, ...s, position })));
}

const label = (bootcamp: ScheduleBootcamp, s: { name: string; track: ScheduleTrack; day: number }) =>
  `${s.name} (bootcamp starting ${bootcamp.startDate}, ${s.track} day ${s.day})`;

/**
 * Adds a session to a track-day at `start`, or straight after its last
 * session. Started inside another, it goes before or after that one as
 * `dropAt` does; any it then runs into are pushed later.
 */
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
  const assessmentId = next.kind === "breakout" ? input.assessmentId : null;
  if (assessmentId && !(await assessmentFits(input.track, assessmentId))) return { ok: false, error: "unknown_assessment" };

  const day = await loadDay(db, bootcampId, input.track, input.day);
  if (day.length >= SCHEDULE_LIMITS.sessionsPerDay) return { ok: false, error: "day_full" };
  const NEW = "new";
  const timed = day.map(({ id, start, minutes }) => ({ id, start, minutes }));
  const laid = dropAt(timed, { id: NEW, start: 0, minutes: input.minutes }, input.start ?? nextStart(day));
  if (!fitsDay(laid)) return { ok: false, error: "past_midnight" };
  const start = laid.find((s) => s.id === NEW)!.start;
  const clash = await newClashes(bootcamp, { day: input.day, start, minutes: input.minutes }, next, null);
  if (clash) return clash;

  let id: string;
  try {
    id = await db.transaction(async (tx) => {
      await writeStarts(tx, bootcampId, laid.filter((s) => s.id !== NEW), day);
      const [made] = await tx
        .insert(scheduleSessions)
        .values({
          bootcampId,
          track: input.track,
          day: input.day,
          start,
          minutes: input.minutes,
          kind: next.kind,
          audience: input.audience ?? defaultAudience(input.track),
          typeId: input.typeId,
          name: input.name,
          description: input.description,
          emoji: input.emoji,
          color: input.color,
          roomId: next.roomId,
          assessmentId,
          createdBy: actorId,
        })
        .returning({ id: scheduleSessions.id });
      await writeStaff(tx, made!.id, next.staff);
      return made!.id;
    });
  } catch (err) {
    if (isForeignKeyViolation(err)) return { ok: false, error: missing({ typeId: input.typeId, assessmentId }) };
    throw err;
  }
  noteAudit({ target: id, targetLabel: label(bootcamp, input) });
  return { ok: true, session: (await getSession(bootcampId, id))! };
}

/** Saves the start of each session in `laid` that differs from `before`. */
async function writeStarts(tx: Tx, bootcampId: string, laid: readonly { id: string; start: number }[], before: readonly SessionRow[]): Promise<void> {
  const was = new Map(before.map((s) => [s.id, s.start]));
  const moved = laid.filter((s) => was.get(s.id) !== s.start);
  if (moved.length === 0) return;
  const rows = moved.map((s) => sql`(${s.id}::uuid, ${s.start}::int)`);
  await tx.execute(sql`
    update ${scheduleSessions} s
    set start_minute = v.start_minute, updated_at = now()
    from (values ${sql.join(rows, sql`, `)}) as v(id, start_minute)
    where s.id = v.id and s.bootcamp_id = ${bootcampId}
  `);
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
  const assessmentId = next.kind === "breakout" ? (patch.assessmentId !== undefined ? patch.assessmentId : before.assessmentId) : null;
  if (assessmentId && assessmentId !== before.assessmentId && !(await assessmentFits(before.track, assessmentId))) {
    return { ok: false, error: "unknown_assessment" };
  }

  // Made longer, it pushes whatever it now runs into later.
  const minutes = patch.minutes ?? before.minutes;
  const day = await loadDay(db, bootcampId, before.track, before.day);
  const laid = settle(day.map((s) => (s.id === sessionId ? { ...s, minutes } : s)), sessionId);
  if (!fitsDay(laid)) return { ok: false, error: "past_midnight" };
  const clash = await newClashes(bootcamp, { day: before.day, start: before.start, minutes, excludeId: sessionId }, next, before);
  if (clash) return clash;

  // Kind, room and staff come from `next`, which settled them together.
  const { name, emoji, color, description, typeId, audience } = patch;
  const fields = { name, emoji, color, minutes: patch.minutes, description, typeId, audience };
  try {
    await db.transaction(async (tx) => {
      await writeStarts(tx, bootcampId, laid, day);
      await tx
        .update(scheduleSessions)
        .set({ ...fields, kind: next.kind, roomId: next.roomId, assessmentId, updatedAt: new Date() })
        .where(eq(scheduleSessions.id, sessionId));
      const sameStaff = JSON.stringify(next.staff) === JSON.stringify(before.staff);
      if (!sameStaff) await writeStaff(tx, sessionId, next.staff);
      const audienceNow = audience ?? before.audience;
      if (!sameStaff || next.kind !== before.kind || audienceNow !== before.audience) await pruneGroups(tx, sessionId, next, audienceNow);
    });
  } catch (err) {
    if (isForeignKeyViolation(err)) return { ok: false, error: missing({ typeId: patch.typeId, assessmentId }) };
    throw err;
  }
  return { ok: true, session: (await getSession(bootcampId, sessionId))! };
}

/** Removes a session; its time is unscheduled, and nothing else moves. */
export async function deleteSession(bootcampId: string, sessionId: string): Promise<{ ok: true } | { ok: false; error: "not_found" }> {
  const bootcamp = await scheduleBootcamp(bootcampId);
  if (!bootcamp) return { ok: false, error: "not_found" };
  const [deleted] = await db
    .delete(scheduleSessions)
    .where(and(eq(scheduleSessions.id, sessionId), eq(scheduleSessions.bootcampId, bootcampId)))
    .returning({ name: scheduleSessions.name, track: scheduleSessions.track, day: scheduleSessions.day });
  if (!deleted) return { ok: false, error: "not_found" };
  noteAudit({ target: sessionId, targetLabel: label(bootcamp, deleted) });
  return { ok: true };
}

// ─── Rearranging ────────────────────────────────────────────────────────────

export const layoutSchema = z.object({
  /** Each track-day that changed, with every session it now holds and when each starts. */
  days: z
    .array(
      z.object({
        track: z.enum(SCHEDULE_TRACKS),
        day: z.number().int().min(1).max(BOOTCAMP_LIMITS.maxDays),
        sessions: z
          .array(z.object({ id: z.string().uuid(), start: z.number().int().min(0).max(SCHEDULE_LIMITS.latestEnd), minutes: sessionLookSchema.minutes }))
          .max(SCHEDULE_LIMITS.sessionsPerDay),
      }),
    )
    .min(1)
    .max(SCHEDULE_TRACKS.length * BOOTCAMP_LIMITS.maxDays),
});

export type LayoutError = "invalid" | "not_found" | "no_day" | "overlap" | "stale";

export const LAYOUT_STATUS_FOR: Record<LayoutError, number> = { invalid: 400, not_found: 404, no_day: 400, overlap: 400, stale: 409 };

/**
 * Saves the start and length of every session on the track-days named. A
 * session moved between days is listed in its new day, and the day it left
 * must be listed too. Refused as `overlap` if a day's sessions would run
 * into one another, start off the quarter hour or before `dayStart`, or end
 * after midnight, and as `stale` unless the sessions named are exactly the
 * ones those days hold now, so two people rearranging at once cannot lose or
 * duplicate one.
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
  if (input.days.some((d) => !fitsDay(d.sessions))) return { ok: false, error: "overlap" };

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
        d.sessions.map((s) => sql`(${s.id}::uuid, ${d.track}, ${d.day}::int, ${s.start}::int, ${s.minutes}::int)`),
      );
      await tx.execute(sql`
        update ${scheduleSessions} s
        set track = v.track, day = v.day, start_minute = v.start_minute, minutes = v.minutes, updated_at = now()
        from (values ${sql.join(rows, sql`, `)}) as v(id, track, day, start_minute, minutes)
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
  start: number;
  minutes: number;
  kind: SessionKind;
  audience: SessionAudience;
  typeId: string | null;
  name: string;
  description: string;
  emoji: string;
  color: SessionColor;
  roomId: string | null;
  assessmentId: string | null;
  staff: StaffRow[];
};

export type FillError = "not_found" | "has_sessions" | "same_bootcamp";

export const FILL_STATUS_FOR: Record<FillError, number> = {
  not_found: 404,
  has_sessions: 409,
  same_bootcamp: 400,
};

/** A checklist item to copy, to do again, with whom its name tags. */
type NewChecklistItem = {
  track: ScheduleTrack;
  day: number;
  period: ChecklistPeriod;
  name: string;
  ownerEmail: string | null;
  ownerName: string;
  mentions: { email: string; fullName: string }[];
};

export type FillSummary = { sessions: number; checklistItems: number; notes: string[] };

async function hasSessions(bootcampId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: scheduleSessions.id })
    .from(scheduleSessions)
    .where(eq(scheduleSessions.bootcampId, bootcampId))
    .limit(1);
  return Boolean(row);
}

const INSERT_BATCH = 100;

/** One track-day of the source's checklist, oldest first, with whom each item tags. */
async function loadChecklistDay(bootcampId: string, track: ScheduleTrack, day: number): Promise<NewChecklistItem[]> {
  const c = scheduleChecklistItems;
  return db
    .select({
      track: c.track,
      day: c.day,
      period: c.period,
      name: c.name,
      ownerEmail: c.ownerEmail,
      ownerName: c.ownerName,
      mentions: sql<{ email: string; fullName: string }[]>`coalesce((
        select json_agg(json_build_object('email', m.email, 'fullName', m.full_name))
        from ${mentions} m where m.checklist_item_id = ${c}.id
      ), '[]'::json)`,
    })
    .from(c)
    .where(and(eq(c.bootcampId, bootcampId), eq(c.track, track), eq(c.day, day)))
    .orderBy(c.createdAt, c.id)
    .limit(CHECKLIST_LIMITS.itemsPerDay);
}

/**
 * Replaces every session of the bootcamp with `sessions`, and adds `items` to
 * its checklists, all to do, each in the same half of its day. Its own items
 * stay: one whose half-day already has an item of the same name is not added
 * again, nor one past a day's limit.
 */
async function writeSchedule(
  actorId: string,
  bootcampId: string,
  sessions: NewSession[],
  items: NewChecklistItem[],
): Promise<{ added: number; had: number; full: number }> {
  const tagger = items.length > 0 ? await taggerOf(actorId) : null;
  return db.transaction(async (tx) => {
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

    const tally = { added: 0, had: 0, full: 0 };
    if (!tagger) return tally;
    // Held until commit, as adding one item holds it, so no add at once takes a day past its limit.
    await tx.select({ id: bootcamps.id }).from(bootcamps).where(eq(bootcamps.id, bootcampId)).for("update");
    const byDay = new Map<string, NewChecklistItem[]>();
    for (const i of items) {
      const key = `${i.track}:${i.day}`;
      byDay.set(key, [...(byDay.get(key) ?? []), i]);
    }
    // Each a millisecond apart, by the database's clock, so the copies keep the source's order rather than share the transaction's time.
    let at = 0;
    for (const dayItems of byDay.values()) {
      const { track, day } = dayItems[0]!;
      const c = scheduleChecklistItems;
      const existing = await tx
        .select({ name: sql<string>`${c.period} || ':' || lower(${c.name})` })
        .from(c)
        .where(and(eq(c.bootcampId, bootcampId), eq(c.track, track), eq(c.day, day)))
        .limit(CHECKLIST_LIMITS.itemsPerDay);
      const names = new Set(existing.map((e) => e.name));
      const fresh = dayItems.filter((i) => !names.has(`${i.period}:${i.name.toLowerCase()}`));
      const room = Math.max(0, CHECKLIST_LIMITS.itemsPerDay - existing.length);
      const adding = fresh.slice(0, room);
      tally.had += dayItems.length - fresh.length;
      tally.full += fresh.length - adding.length;
      if (adding.length === 0) continue;

      const made = await tx
        .insert(c)
        .values(
          adding.map((i, j) => ({
            bootcampId,
            track,
            day,
            period: i.period,
            name: i.name,
            ownerEmail: i.ownerEmail,
            ownerName: i.ownerName,
            createdBy: actorId,
            createdByName: tagger.taggedByName,
            createdByEmail: tagger.taggedByEmail,
            createdAt: sql`now() + ${at + j} * interval '1 millisecond'`,
          })),
        )
        .returning({ id: c.id, createdAt: c.createdAt });
      at += adding.length;
      const tags = adding.flatMap((i, j) =>
        i.mentions.map((m) => ({ checklistItemId: made[j]!.id, bootcampId, ...m, ...tagger, createdAt: made[j]!.createdAt })),
      );
      if (tags.length > 0) await tx.insert(mentions).values(tags);
      tally.added += adding.length;
    }
    return tally;
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
 *
 * The checklists of the days it keeps, and Prep Day's, are added to its own,
 * every item to do. An owner or a tag that is not an instructor of this
 * bootcamp is left off, and said so.
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
  const checklistDays: { track: ScheduleTrack; day: number }[] = [CHECKLIST_PREP_DAY];
  let hadRooms = false;
  for (const track of SCHEDULE_TRACKS) {
    const from = trackDays(track, source) ?? 0;
    const to = trackDays(track, target) ?? 0;
    for (let d = 1; d <= Math.min(from, to); d++) checklistDays.push({ track, day: d });
    const days = await Promise.all(Array.from({ length: Math.min(from, to) }, (_, d) => loadDay(db, sourceId, track, d + 1)));
    for (const day of days) {
      for (const s of day) {
        if (s.roomId || s.staff.some((p) => p.roomId)) hadRooms = true;
        sessions.push({
          track: s.track,
          day: s.day,
          start: s.start,
          minutes: s.minutes,
          kind: s.kind,
          audience: s.audience,
          typeId: s.typeId,
          name: s.name,
          description: s.description,
          emoji: s.emoji,
          color: s.color,
          roomId: keepRooms ? s.roomId : null,
          assessmentId: s.assessmentId,
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
  const pool = await instructorPool(bootcampId);
  const outsiders = outsiderNote(sessions, pool);
  if (outsiders) notes.push(outsiders);

  const inPool = new Set(pool.map((p) => p.email));
  const leftOff = new Map<string, string>();
  const items = (await Promise.all(checklistDays.map((d) => loadChecklistDay(sourceId, d.track, d.day)))).flat().map((i) => {
    if (i.ownerEmail && !inPool.has(i.ownerEmail)) leftOff.set(i.ownerEmail, i.ownerName || i.ownerEmail);
    for (const m of i.mentions) if (!inPool.has(m.email)) leftOff.set(m.email, m.fullName || m.email);
    const owned = !i.ownerEmail || inPool.has(i.ownerEmail);
    return {
      ...i,
      ownerEmail: owned ? i.ownerEmail : null,
      ownerName: owned ? i.ownerName : "",
      mentions: i.mentions.filter((m) => inPool.has(m.email)),
    };
  });
  if (leftOff.size > 0) {
    notes.push(
      `Left ${leftOff.size} ${leftOff.size === 1 ? "person" : "people"} off checklist items, as owner or tag, who ${leftOff.size === 1 ? "is" : "are"} not a Training administrator or a guest judge of this bootcamp: ${someNames([...leftOff.values()])}.`,
    );
  }

  const copied = await writeSchedule(actorId, bootcampId, sessions, items);
  if (copied.had > 0) {
    notes.push(`Left out ${copied.had} checklist item${copied.had === 1 ? "" : "s"} this bootcamp already has on the same half-day.`);
  }
  if (copied.full > 0) {
    notes.push(`Left out ${copied.full} checklist item${copied.full === 1 ? "" : "s"}: a day holds at most ${CHECKLIST_LIMITS.itemsPerDay}.`);
  }
  return { ok: true, summary: { sessions: sessions.length, checklistItems: copied.added, notes } };
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
