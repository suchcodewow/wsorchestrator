/**
 * eVals Settings → Google Meetings: the Revenue Enablement calendar meetings
 * picked for the cohort, a page at a time, saving and changing them, the
 * sync's live switch and log, administrators' word on attendance, where each
 * person stands with each meeting for the Cohorts page's Current tab, and the
 * Google account the sync acts as. Saving a meeting touches nothing outside
 * the app; `meeting-sync.ts` sends the invites when Sync Now is pressed.
 */

import "server-only";

import { and, desc, eq, gt, inArray, isNotNull, lt, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  employees,
  EVALS_SETTINGS_KEYS,
  evalsSettings,
  GOOGLE_CONNECTION_KEY,
  googleConnections,
  googleMeetings,
  MEETING_SELECTION_LIMITS,
  MEETING_STAGES,
  MEETING_TRACKS,
  meetingAttendanceMarks,
  meetingInvites,
  meetingOccurrences,
  meetingSelections,
  meetingSyncChanges,
  meetingSyncRuns,
  users,
  type MeetingSelection,
  type MeetingStage,
  type MeetingSyncAction,
  type MeetingSyncStatus,
  type MeetingTrack,
} from "@/db/schema";
import { getTestGroup } from "@/lib/cohorts/test-group";
import { currentCohortPeople } from "@/lib/evals/current-cohort";
import { cleanMeetingName, meetingIsFor, meetingMark, offsetHour, TIMEZONE_HOURS, type MeetingMark } from "@/lib/evals/meeting-plan";
import type { MeetingSelectionSort, MeetingSyncChangeSort, MeetingSyncSort } from "@/lib/list-specs";
import { PAGE_SIZE, pageWindow, toPage, type ListQuery, type Page } from "@/lib/paging";
import { orderFor, searchAny } from "@/lib/paging-sql";
import { isUniqueViolation } from "@/lib/scheduler/pg-errors";
import { activeBootcamp } from "@/lib/scheduler/bootcamps";
import { zoomApp } from "@/lib/zoom";
import { zoomConnectionStatus, type ZoomConnectionStatus } from "@/lib/zoom-connection";

/** A run still marked running after this was cut off, and another may start. */
export const SYNC_STALE_MS = 10 * 60_000;

/* ------------------------------------------------------------------ */
/* The picked meetings                                                 */
/* ------------------------------------------------------------------ */

export type MeetingSelectionRow = {
  id: string;
  name: string;
  stage: MeetingStage;
  track: MeetingTrack;
  /** The whole-hour UTC offsets it covers; both null when it is for every time zone. */
  timezoneFrom: number | null;
  timezoneTo: number | null;
  /** Days after someone's start date before this meeting suits them. */
  minDaysAfterStart: number;
  syncedAt: Date | null;
  /** When the next occurrence starts, as of the last live sync; null with none to come. */
  nextStartsAt: Date | null;
  /** Occurrences still to start. */
  upcoming: number;
  /** People from the cohort on an occurrence still to start. */
  invited: number;
  /** People Zoom saw join, or an administrator marked attended. */
  attended: number;
  addedBy: string | null;
  createdAt: Date;
};

const s = meetingSelections;
const o = meetingOccurrences;
const i = meetingInvites;
const k = meetingAttendanceMarks;

const SORT_COLUMNS = {
  name: sql`lower(${s.name})`,
  stage: s.stage,
  track: s.track,
  createdAt: s.createdAt,
} as const;

/** One page of the picked meetings; the search matches the name. */
export async function listMeetingSelections(query: ListQuery<MeetingSelectionSort>): Promise<Page<MeetingSelectionRow>> {
  const { limit, offset } = pageWindow(query.page);
  const rows = await db
    .select({
      id: s.id,
      name: s.name,
      stage: s.stage,
      track: s.track,
      timezoneFrom: s.timezoneFrom,
      timezoneTo: s.timezoneTo,
      minDaysAfterStart: s.minDaysAfterStart,
      syncedAt: s.syncedAt,
      createdAt: s.createdAt,
      nextStartsAt: sql<Date | null>`(select min(${o.startsAt}) from ${o} where ${o.meetingId} = ${s.id} and ${o.startsAt} > now())`.mapWith(
        (v: string | Date | null) => (v === null ? null : new Date(v)),
      ),
      upcoming: sql<number>`(select count(*) from ${o} where ${o.meetingId} = ${s.id} and ${o.startsAt} > now())::int`,
      invited: sql<number>`(select count(distinct ${i.email}) from ${i} join ${o} on ${o.id} = ${i.occurrenceId}
        where ${o.meetingId} = ${s.id} and ${o.startsAt} > now() and ${i.role} = 'member' and not ${i.test})::int`,
      attended: sql<number>`(select count(*) from (
          select ${i.email} as email from ${i} join ${o} on ${o.id} = ${i.occurrenceId}
            where ${o.meetingId} = ${s.id} and ${i.attendance} = 'attended' and ${i.role} = 'member' and not ${i.test}
              and not exists (select 1 from ${k} where ${k.meetingId} = ${s.id} and ${k.email} = ${i.email} and not ${k.attended})
          union
          select ${k.email} from ${k} where ${k.meetingId} = ${s.id} and ${k.attended}
        ) as a)::int`,
      addedByName: users.name,
      addedByEmail: users.email,
    })
    .from(s)
    .leftJoin(users, eq(users.id, s.createdBy))
    .where(searchAny(query.q, [s.name]))
    .orderBy(...orderFor(SORT_COLUMNS[query.sort], query.dir, sql`lower(${s.name})`, s.id))
    .limit(limit)
    .offset(offset);
  return toPage(
    rows.map(({ addedByName, addedByEmail, ...row }) => ({ ...row, addedBy: addedByName ?? addedByEmail })),
    query.page,
  );
}

/**
 * For the timezone map in the meeting dialog: how many of the people a stage
 * and track cover are in each whole-hour UTC offset today, and how many have
 * no time zone on record, who a time zone filter leaves out.
 */
export async function meetingTimezoneCoverage(
  stage: MeetingStage,
  track: MeetingTrack,
  at: Date = new Date(),
): Promise<{ byHour: Record<string, number>; people: Record<string, string[]>; unknown: number; total: number }> {
  const byHour: Record<string, number> = {};
  const people: Record<string, string[]> = {};
  let unknown = 0;
  let total = 0;
  for (const { fullName, timezone } of await currentCohortPeople(stage, track)) {
    total += 1;
    let hour: number | null = null;
    try {
      hour = timezone ? offsetHour(timezone, at) : null;
    } catch {
      hour = null;
    }
    if (hour === null) unknown += 1;
    else {
      byHour[hour] = (byHour[hour] ?? 0) + 1;
      (people[hour] ??= []).push(fullName);
    }
  }
  return { byHour, people, unknown, total };
}

export async function meetingSelectionCount(): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(s);
  return row?.n ?? 0;
}

/** Up to a page of the picked meetings after `after` by id; the sync walks them with it. */
export async function meetingSelectionsAfter(after: string | null): Promise<MeetingSelection[]> {
  return db
    .select()
    .from(s)
    .where(after ? sql`${s.id} > ${after}::uuid` : undefined)
    .orderBy(s.id)
    .limit(PAGE_SIZE);
}

export async function meetingSelection(id: string): Promise<MeetingSelection | null> {
  const [row] = await db.select().from(s).where(eq(s.id, id));
  return row ?? null;
}

export type MeetingSelectionError = "invalid" | "not_found" | "duplicate" | "not_connected" | "remote_failed" | "running";

export const STATUS_FOR: Record<MeetingSelectionError, number> = {
  invalid: 400,
  not_found: 404,
  duplicate: 409,
  not_connected: 409,
  remote_failed: 502,
  running: 409,
};

const daysAfterStart = z.number().int().min(0).max(365);

const offsetHours = z.number().int().min(TIMEZONE_HOURS.min).max(TIMEZONE_HOURS.max);

/** Both ends or neither; a first after the second wraps through the date line. */
function timezoneRangeValid(v: { timezoneFrom?: number | null; timezoneTo?: number | null }): boolean {
  const from = v.timezoneFrom ?? null;
  const to = v.timezoneTo ?? null;
  return (from === null) === (to === null);
}

export const meetingSelectionSchema = z
  .object({
    /** As the calendar names its events; GET /calendar lists them. */
    name: z.string().trim().min(1).max(MEETING_SELECTION_LIMITS.name).transform(cleanMeetingName),
    stage: z.enum(MEETING_STAGES),
    track: z.enum(MEETING_TRACKS),
    /** The whole-hour UTC offsets covered; both null (or left out) for every time zone. */
    timezoneFrom: offsetHours.nullish(),
    timezoneTo: offsetHours.nullish(),
    /** Days after a person's start date before the meeting suits them; 0 when left out. */
    minDaysAfterStart: daysAfterStart.optional(),
  })
  .refine(timezoneRangeValid);

export type MeetingSelectionInput = z.infer<typeof meetingSelectionSchema>;

export const meetingSelectionPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(MEETING_SELECTION_LIMITS.name).transform(cleanMeetingName),
    stage: z.enum(MEETING_STAGES),
    track: z.enum(MEETING_TRACKS),
    timezoneFrom: offsetHours.nullable(),
    timezoneTo: offsetHours.nullable(),
    minDaysAfterStart: daysAfterStart,
  })
  .partial()
  .refine((v) => (v.timezoneFrom === undefined) === (v.timezoneTo === undefined) && timezoneRangeValid(v));

type Saved = { ok: true; meeting: { id: string; name: string } } | { ok: false; error: MeetingSelectionError };

/** Picks a meeting; a name already picked, in any case, is refused. */
export async function createMeetingSelection(actorId: string, input: MeetingSelectionInput): Promise<Saved> {
  try {
    const [row] = await db
      .insert(s)
      .values({ ...input, timezoneFrom: input.timezoneFrom ?? null, timezoneTo: input.timezoneTo ?? null, minDaysAfterStart: input.minDaysAfterStart ?? 0, createdBy: actorId })
      .returning({ id: s.id, name: s.name });
    return { ok: true, meeting: row! };
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, error: "duplicate" };
    throw err;
  }
}

/**
 * Changes what was given. A changed name or audience takes effect at the next
 * sync, which takes off the upcoming invites of anyone it no longer covers.
 * Renaming starts over: the occurrences of the old name, and who came to them,
 * go with it.
 */
export async function updateMeetingSelection(id: string, patch: z.infer<typeof meetingSelectionPatchSchema>): Promise<Saved> {
  const current = await meetingSelection(id);
  if (!current) return { ok: false, error: "not_found" };
  const next = {
    name: patch.name ?? current.name,
    stage: patch.stage ?? current.stage,
    track: patch.track ?? current.track,
    timezoneFrom: patch.timezoneFrom === undefined ? current.timezoneFrom : patch.timezoneFrom,
    timezoneTo: patch.timezoneTo === undefined ? current.timezoneTo : patch.timezoneTo,
    minDaysAfterStart: patch.minDaysAfterStart ?? current.minDaysAfterStart,
  };
  if (
    next.name === current.name &&
    next.stage === current.stage &&
    next.track === current.track &&
    next.timezoneFrom === current.timezoneFrom &&
    next.timezoneTo === current.timezoneTo &&
    next.minDaysAfterStart === current.minDaysAfterStart
  ) {
    return { ok: true, meeting: { id, name: current.name } };
  }
  try {
    const row = await db.transaction(async (tx) => {
      if (next.name.toLowerCase() !== current.name.toLowerCase()) {
        await tx.delete(o).where(eq(o.meetingId, id));
        await tx.delete(k).where(eq(k.meetingId, id));
      }
      const [updated] = await tx
        .update(s)
        .set({ ...next, updatedAt: new Date(), ...(next.name.toLowerCase() !== current.name.toLowerCase() && { syncedAt: null }) })
        .where(eq(s.id, id))
        .returning({ id: s.id, name: s.name });
      return updated;
    });
    return row ? { ok: true, meeting: row } : { ok: false, error: "not_found" };
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, error: "duplicate" };
    throw err;
  }
}

export async function removeMeetingSelectionRow(id: string): Promise<boolean> {
  const deleted = await db.delete(s).where(eq(s.id, id)).returning({ id: s.id });
  return deleted.length > 0;
}

/**
 * The guests the sync put on a meeting's occurrences still to start, by
 * event, for taking them off before the meeting is deleted or renamed.
 */
export async function upcomingSyncedGuests(meetingId: string): Promise<{ eventId: string; emails: string[] }[]> {
  const rows = await db
    .select({ eventId: o.eventId, email: i.email })
    .from(i)
    .innerJoin(o, eq(o.id, i.occurrenceId))
    .where(and(eq(o.meetingId, meetingId), gt(o.startsAt, sql`now()`), eq(i.addedBySync, true)))
    .orderBy(o.startsAt)
    .limit(5_000);
  const byEvent = new Map<string, string[]>();
  for (const r of rows) byEvent.set(r.eventId, [...(byEvent.get(r.eventId) ?? []), r.email]);
  return [...byEvent].map(([eventId, emails]) => ({ eventId, emails }));
}

/* ------------------------------------------------------------------ */
/* Live or dry run                                                     */
/* ------------------------------------------------------------------ */

/** Whether the sync may change the calendar; false, a dry run, until someone says otherwise. */
export async function getMeetingSyncLive(): Promise<boolean> {
  const [row] = await db
    .select({ value: evalsSettings.value })
    .from(evalsSettings)
    .where(eq(evalsSettings.key, EVALS_SETTINGS_KEYS.meetingSyncLive));
  return row?.value === "true";
}

export async function setMeetingSyncLive(actorId: string, live: boolean): Promise<void> {
  const value = live ? "true" : "false";
  await db
    .insert(evalsSettings)
    .values({ key: EVALS_SETTINGS_KEYS.meetingSyncLive, value, updatedBy: actorId })
    .onConflictDoUpdate({
      target: evalsSettings.key,
      set: { value, updatedBy: actorId, updatedAt: new Date() },
    });
}

/* ------------------------------------------------------------------ */
/* Attendance marks                                                    */
/* ------------------------------------------------------------------ */

export const attendanceMarkSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  /** True for attended, false for missed, null to go back to what Zoom says. */
  attended: z.boolean().nullable(),
});

/** Records, or with `attended` null clears, an administrator's word on one person and one meeting. */
export async function setAttendanceMark(
  actorId: string,
  meetingId: string,
  input: z.infer<typeof attendanceMarkSchema>,
): Promise<{ ok: true; meeting: { id: string; name: string } } | { ok: false; error: "not_found" }> {
  const meeting = await meetingSelection(meetingId);
  if (!meeting) return { ok: false, error: "not_found" };
  if (input.attended === null) {
    await db.delete(k).where(and(eq(k.meetingId, meetingId), eq(k.email, input.email)));
  } else {
    await db
      .insert(k)
      .values({ meetingId, email: input.email, attended: input.attended, markedBy: actorId })
      .onConflictDoUpdate({
        target: [k.meetingId, k.email],
        set: { attended: input.attended, markedBy: actorId, markedAt: new Date() },
      });
  }
  return { ok: true, meeting: { id: meeting.id, name: meeting.name } };
}

/* ------------------------------------------------------------------ */
/* Where each person stands, for the Current tab                       */
/* ------------------------------------------------------------------ */

export type PersonMeetingStatus = {
  meetingId: string;
  name: string;
  mark: MeetingMark;
  /** An administrator's word, over Zoom's: attended, missed, or none. */
  marked: boolean | null;
  /** When the occurrence they hold starts; null when they hold none. */
  startsAt: Date | null;
};

/**
 * For each of a page's people, where they stand with each picked meeting that
 * is for them and has had a live sync: attended, accepted, not yet answered,
 * or with no occurrence left before the active bootcamp. Test-group invites
 * are left out; the Current tab is the real cohort.
 */
export async function meetingStatusesFor(
  people: readonly { email: string; stage: "bootcamp" | "intermediate"; track: string | null }[],
): Promise<Map<string, PersonMeetingStatus[]>> {
  const out = new Map<string, PersonMeetingStatus[]>();
  const candidates = people
    .filter((p): p is { email: string; stage: "bootcamp" | "intermediate"; track: "sales" | "engineer" } => p.track === "sales" || p.track === "engineer")
    .map((p) => ({ ...p, email: p.email.trim().toLowerCase() }));
  if (candidates.length === 0) return out;
  const zones = new Map(
    (await db.select({ email: sql<string>`lower(${employees.email})`, timezone: employees.timezone }).from(employees).where(inArray(sql`lower(${employees.email})`, candidates.map((c) => c.email))).limit(PAGE_SIZE))
      .map((r) => [r.email, r.timezone]),
  );
  const members = candidates.map((c) => ({ ...c, timezone: zones.get(c.email) ?? null }));
  const now = new Date();

  const selections = await db
    .select({ id: s.id, name: s.name, stage: s.stage, track: s.track, timezoneFrom: s.timezoneFrom, timezoneTo: s.timezoneTo })
    .from(s)
    .where(isNotNull(s.syncedAt))
    .orderBy(sql`lower(${s.name})`)
    .limit(PAGE_SIZE);
  if (selections.length === 0) return out;
  const ids = selections.map((m) => m.id);
  const emails = [...new Set(members.map((m) => m.email))];

  const cutoff = (await activeBootcamp())?.startDate ?? null;
  const [left, held, marks] = await Promise.all([
    db
      .select({ meetingId: o.meetingId })
      .from(o)
      .where(and(inArray(o.meetingId, ids), gt(o.startsAt, sql`now()`), cutoff ? lt(o.startDate, cutoff) : undefined))
      .groupBy(o.meetingId),
    db
      .select({
        meetingId: o.meetingId,
        email: i.email,
        attended: sql<boolean>`bool_or(${i.attendance} = 'attended')`,
        invited: sql<boolean>`bool_or(${i.attendance} is null and ${o.attendanceReadAt} is null)`,
        response: sql<string | null>`(array_agg(${i.responseStatus} order by ${o.startsAt})
          filter (where ${i.attendance} is null and ${o.attendanceReadAt} is null))[1]`,
        startsAt: sql<string | null>`min(${o.startsAt}) filter (where ${i.attendance} is null and ${o.attendanceReadAt} is null)`,
      })
      .from(i)
      .innerJoin(o, eq(o.id, i.occurrenceId))
      .where(and(inArray(o.meetingId, ids), inArray(i.email, emails), eq(i.role, "member"), eq(i.test, false)))
      .groupBy(o.meetingId, i.email),
    db
      .select({ meetingId: k.meetingId, email: k.email, attended: k.attended })
      .from(k)
      .where(and(inArray(k.meetingId, ids), inArray(k.email, emails))),
  ]);
  const anyLeft = new Set(left.map((r) => r.meetingId));
  const heldBy = new Map(held.map((r) => [`${r.meetingId} ${r.email}`, r]));
  const markOf = new Map(marks.map((r) => [`${r.meetingId} ${r.email}`, r.attended]));

  for (const member of members) {
    const list: PersonMeetingStatus[] = [];
    for (const meeting of selections) {
      if (!meetingIsFor(meeting, member, now)) continue;
      const key = `${meeting.id} ${member.email}`;
      const h = heldBy.get(key);
      const marked = markOf.get(key) ?? null;
      const mark = meetingMark({
        attended: marked === true || (marked === null && Boolean(h?.attended)),
        response: h?.response ?? null,
        invited: Boolean(h?.invited),
        anyLeft: anyLeft.has(meeting.id),
      });
      list.push({ meetingId: meeting.id, name: meeting.name, mark, marked, startsAt: h?.startsAt ? new Date(h.startsAt) : null });
    }
    out.set(member.email, list);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* The sync's log                                                      */
/* ------------------------------------------------------------------ */

export type MeetingSyncRunSummary = {
  id: string;
  triggeredBy: string | null;
  status: MeetingSyncStatus;
  dryRun: boolean;
  testGroup: boolean;
  startedAt: Date;
  finishedAt: Date | null;
  invited: number;
  removed: number;
  attended: number;
  missed: number;
  noneLeft: number;
  failures: number;
  unfinished: boolean;
  error: string | null;
  notes: string[];
};

const r = meetingSyncRuns;

const RUN_SORT_COLUMNS = {
  startedAt: r.startedAt,
  triggeredBy: sql`lower(coalesce(nullif(${users.name}, ''), ${users.email}))`,
  status: r.status,
} as const;

const runColumns = {
  id: r.id,
  triggeredByName: users.name,
  triggeredByEmail: users.email,
  status: r.status,
  dryRun: r.dryRun,
  testGroup: r.testGroup,
  startedAt: r.startedAt,
  finishedAt: r.finishedAt,
  invited: r.invited,
  removed: r.removed,
  attended: r.attended,
  missed: r.missed,
  noneLeft: r.noneLeft,
  failures: r.failures,
  unfinished: r.unfinished,
  error: r.error,
  notes: r.notes,
};

type RunRow = { triggeredByName: string | null; triggeredByEmail: string | null } & Omit<MeetingSyncRunSummary, "triggeredBy">;

function summarize({ triggeredByName, triggeredByEmail, ...rest }: RunRow, staleBefore: number): MeetingSyncRunSummary {
  return {
    ...rest,
    triggeredBy: triggeredByName ?? triggeredByEmail,
    // The next run closes it for good; until then, say what happened.
    ...(rest.status === "running" && rest.startedAt.getTime() < staleBefore
      ? { status: "failed" as const, error: "Did not finish — the server stopped mid-sync." }
      : {}),
  };
}

/** One page of the run log, newest first unless asked otherwise. The search matches who started it, the status and the error. */
export async function listMeetingSyncRuns(query: ListQuery<MeetingSyncSort>): Promise<Page<MeetingSyncRunSummary>> {
  const { limit, offset } = pageWindow(query.page);
  const rows = await db
    .select(runColumns)
    .from(r)
    .leftJoin(users, eq(users.id, r.triggeredBy))
    .where(searchAny(query.q, [users.name, users.email, r.status, r.error]))
    .orderBy(...orderFor(RUN_SORT_COLUMNS[query.sort], query.dir, desc(r.startedAt), r.id))
    .limit(limit)
    .offset(offset);
  const staleBefore = Date.now() - SYNC_STALE_MS;
  return toPage(rows.map((row) => summarize(row, staleBefore)), query.page);
}

export async function getMeetingSyncRun(id: string): Promise<MeetingSyncRunSummary | null> {
  const [row] = await db.select(runColumns).from(r).leftJoin(users, eq(users.id, r.triggeredBy)).where(eq(r.id, id));
  return row ? summarize(row, Date.now() - SYNC_STALE_MS) : null;
}

/** Whether a run is under way: one marked running that has not gone stale. */
export async function meetingSyncInProgress(): Promise<boolean> {
  const [row] = await db
    .select({ id: r.id })
    .from(r)
    .where(and(eq(r.status, "running"), sql`${r.startedAt} >= ${new Date(Date.now() - SYNC_STALE_MS)}`))
    .limit(1);
  return Boolean(row);
}

/** When the last run that was not a dry run finished, and how. */
export async function lastLiveMeetingSync(): Promise<{ finishedAt: Date; status: MeetingSyncStatus; error: string | null } | null> {
  const [row] = await db
    .select({ finishedAt: r.finishedAt, status: r.status, error: r.error })
    .from(r)
    .where(and(eq(r.dryRun, false), isNotNull(r.finishedAt)))
    .orderBy(desc(r.finishedAt))
    .limit(1);
  return row?.finishedAt ? { finishedAt: row.finishedAt, status: row.status, error: row.error } : null;
}

export type MeetingSyncChangeRow = {
  id: string;
  meetingName: string;
  occurrenceStartsAt: Date | null;
  action: MeetingSyncAction;
  email: string;
  fullName: string | null;
  detail: string | null;
  at: Date;
};

const c = meetingSyncChanges;

const CHANGE_SORT_COLUMNS = {
  at: c.at,
  meetingName: sql`lower(${c.meetingName})`,
  action: c.action,
  email: c.email,
} as const;

/** Which of a run's changes to list: invites sent and taken back, attendance read, or what went wrong. */
export const MEETING_CHANGE_KINDS = ["invites", "attendance", "problems"] as const;
export type MeetingChangeKind = (typeof MEETING_CHANGE_KINDS)[number];

export function isMeetingChangeKind(value: unknown): value is MeetingChangeKind {
  return MEETING_CHANGE_KINDS.includes(value as MeetingChangeKind);
}

const OF_KIND: Record<MeetingChangeKind, SQL> = {
  invites: inArray(c.action, ["invited", "removed", "cancelled"]),
  attendance: inArray(c.action, ["attended", "missed"]),
  problems: inArray(c.action, ["failed", "none_left"]),
};

/** How many of a run's changes are of each kind, whatever the search. */
export async function countMeetingSyncChanges(runId: string): Promise<Record<MeetingChangeKind | "all", number>> {
  const [row] = await db
    .select({
      all: sql<number>`count(*)::int`,
      invites: sql<number>`count(*) filter (where ${OF_KIND.invites})::int`,
      attendance: sql<number>`count(*) filter (where ${OF_KIND.attendance})::int`,
      problems: sql<number>`count(*) filter (where ${OF_KIND.problems})::int`,
    })
    .from(c)
    .where(eq(c.runId, runId));
  return row ?? { all: 0, invites: 0, attendance: 0, problems: 0 };
}

/** One page of what a run did, only of one kind when `kind` is given. The search matches the meeting, action, email, name or detail. */
export async function listMeetingSyncChanges(
  runId: string,
  query: ListQuery<MeetingSyncChangeSort>,
  kind: MeetingChangeKind | null = null,
): Promise<Page<MeetingSyncChangeRow>> {
  const { limit, offset } = pageWindow(query.page);
  // Qualified by hand: with no join, Drizzle writes a bare `"email"`, which inside the subquery would mean `e.email`.
  const fullName = sql<string | null>`(select e.full_name from employees e where lower(e.email) = "meeting_sync_changes"."email" limit 1)`;
  const rows = await db
    .select({
      id: c.id,
      meetingName: c.meetingName,
      occurrenceStartsAt: c.occurrenceStartsAt,
      action: c.action,
      email: c.email,
      fullName,
      detail: c.detail,
      at: c.at,
    })
    .from(c)
    .where(and(eq(c.runId, runId), kind ? OF_KIND[kind] : undefined, searchAny(query.q, [c.meetingName, c.action, c.email, c.detail, fullName])))
    .orderBy(...orderFor(CHANGE_SORT_COLUMNS[query.sort], query.dir, c.at, c.id))
    .limit(limit)
    .offset(offset);
  return toPage(rows, query.page);
}

/* ------------------------------------------------------------------ */
/* Who is on every invite                                              */
/* ------------------------------------------------------------------ */

/**
 * Everyone who holds the Assessments Administrator role, lowercased. A
 * platform administrator counts as one inside the app, but is not invited
 * unless they hold the role too: these are the people who run the meetings.
 */
export async function assessmentAdministratorEmails(): Promise<string[]> {
  const rows = await db
    .select({ email: sql<string>`lower(${users.email})` })
    .from(users)
    .where(and(eq(users.assessmentsRole, "administrator"), isNotNull(users.email)))
    .orderBy(sql`lower(${users.email})`)
    .limit(PAGE_SIZE);
  return rows.map((row) => row.email);
}

/* ------------------------------------------------------------------ */
/* The connected Google account                                        */
/* ------------------------------------------------------------------ */

const g = googleConnections;

export type GoogleConnection = typeof googleConnections.$inferSelect;

export async function googleConnection(): Promise<GoogleConnection | null> {
  const [row] = await db.select().from(g).where(eq(g.key, GOOGLE_CONNECTION_KEY));
  return row ?? null;
}

/** The connection as the page and the API show it: never the token. */
export type GoogleConnectionStatus = {
  email: string;
  connectedAt: Date;
  connectedBy: string | null;
};

export async function googleConnectionStatus(): Promise<GoogleConnectionStatus | null> {
  const [row] = await db
    .select({ email: g.email, connectedAt: g.connectedAt, connectedByName: users.name, connectedByEmail: users.email })
    .from(g)
    .leftJoin(users, eq(users.id, g.connectedBy))
    .where(eq(g.key, GOOGLE_CONNECTION_KEY));
  if (!row) return null;
  const { connectedByName, connectedByEmail, ...rest } = row;
  return { ...rest, connectedBy: connectedByName ?? connectedByEmail };
}

/**
 * Stores the account the consent screen returned. Reconnecting the same
 * account only replaces its token. A different account is refused while a
 * meeting the old create-a-meeting flow made is still on its calendar: the
 * new account could not cancel it.
 */
export async function saveGoogleConnection(
  actorId: string,
  account: { email: string; refreshToken: Buffer; scope: string },
): Promise<{ ok: true; replaced: boolean } | { ok: false; error: "different_account"; current: string }> {
  const current = await googleConnection();
  if (current && current.email !== account.email) {
    const [made] = await db.select({ id: googleMeetings.id }).from(googleMeetings).where(isNotNull(googleMeetings.googleEventId)).limit(1);
    if (made) return { ok: false, error: "different_account", current: current.email };
  }
  const sameAccount = current?.email === account.email;
  await db
    .insert(g)
    .values({ key: GOOGLE_CONNECTION_KEY, ...account, connectedBy: actorId })
    .onConflictDoUpdate({
      target: g.key,
      set: {
        ...account,
        connectedBy: actorId,
        connectedAt: new Date(),
        lastSyncError: null,
        ...(sameAccount ? {} : { calendarId: null, sharedWith: [] }),
      },
    });
  return { ok: true, replaced: current !== null };
}

/* ------------------------------------------------------------------ */
/* The tab as a whole                                                  */
/* ------------------------------------------------------------------ */

export type GoogleMeetingsOverview = {
  connection: GoogleConnectionStatus | null;
  /** Attendance is read from Zoom only when the app is set up and a Zoom user is connected. */
  zoom: { configured: boolean; connection: ZoomConnectionStatus | null };
  /** Guests on every occurrence a cohort member is invited to. */
  administrators: string[];
  live: boolean;
  running: boolean;
  testGroup: { on: boolean; suffix: string; members: number };
  /** The active bootcamp's start date, before which each person is invited; null with none active. */
  cutoff: string | null;
  lastLiveSync: { finishedAt: Date; status: MeetingSyncStatus; error: string | null } | null;
  /** Old create-a-meeting invites still to cancel; the next live sync cancels them. */
  legacyMeetings: number;
  /** Meetings picked from the calendar. */
  meetingCount: number;
};

export async function googleMeetingsOverview(): Promise<GoogleMeetingsOverview> {
  const [connection, zoomConnection, administrators, live, running, group, bootcamp, lastLiveSync, legacy, meetingCount] = await Promise.all([
    googleConnectionStatus(),
    zoomConnectionStatus(),
    assessmentAdministratorEmails(),
    getMeetingSyncLive(),
    meetingSyncInProgress(),
    getTestGroup(),
    activeBootcamp(),
    lastLiveMeetingSync(),
    db.select({ n: sql<number>`count(*)::int` }).from(googleMeetings),
    meetingSelectionCount(),
  ]);
  return {
    connection,
    zoom: { configured: zoomApp() !== null, connection: zoomConnection },
    administrators,
    live,
    running,
    testGroup: { on: group.on, suffix: group.suffix, members: group.members.length },
    cutoff: bootcamp?.startDate ?? null,
    lastLiveSync,
    legacyMeetings: legacy[0]?.n ?? 0,
    meetingCount,
  };
}
