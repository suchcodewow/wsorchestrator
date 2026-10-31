/**
 * The Google Meetings sync, as the connected Google account, in one logged
 * run: on its schedule (Admin Settings → Timed Jobs, `lib/timed-job-runs.ts`),
 * and with Sync Now on eVals Settings → Google Meetings.
 *
 * 1. Reads the Revenue Enablement calendar's next 60 days, and stores each
 *    event of every picked meeting's name as one of its occurrences, with the
 *    Zoom meeting in its link and each guest's reply.
 * 2. For each occurrence over for half an hour whose attendance is not known,
 *    asks the connected Zoom user who joined.
 * 3. Invites each person on the Cohorts page's Current tab whom a meeting is
 *    for to its next occurrence in their window, and anyone who missed or
 *    declined theirs to the next one after it, or to every occurrence in it when the meeting
 *    is set to all meetings (`meeting-plan.ts` has the rules), with every
 *    Assessments Administrator on each occurrence a cohort member is on. The
 *    window is before the active bootcamp starts, except for an Intermediate
 *    meeting's people who take the bootcamp first, who RSVP'd to it: theirs
 *    runs from after its last day to the next intermediate class.
 *
 * With the test group on, the test group stands in for the cohort, its
 * invites are marked as its own, and administrators are not invited; turning
 * the group off takes its invites away (`cancelTestMeetingInvites`).
 *
 * Until an administrator turns it live, every run is a dry run: it reads the
 * calendar and Zoom and logs whom it would invite and take off, but writes
 * nothing to either and changes no invite. It does store the occurrences it
 * read, so the Current tab can list them. Preview makes any run a dry run. QA
 * shares production's Google Workspace, so QA stays in dry run.
 *
 * The first live run also cancels, once, the upcoming invites and Zoom
 * meetings the old create-a-meeting flow made, and forgets them.
 *
 * Google never emails anyone about a change the sync makes: every write to the
 * calendar is sent with sendUpdates=none, so a guest finds the invite on their
 * calendar rather than in their inbox. An invite already right is left alone.
 * The sync takes off an invite only those it put there.
 */

import "server-only";

import { and, eq, gt, inArray, lt, notInArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  employees,
  googleMeetings,
  intakeResponses,
  meetingAttendanceMarks,
  meetingInvites,
  meetingOccurrences,
  meetingSelections,
  meetingSyncChanges,
  meetingSyncRuns,
  type GoogleMeeting,
  type MeetingAttendance,
  type MeetingInviteRole,
  type MeetingSelection,
  type MeetingSyncAction,
  type MeetingSyncStatus,
  type MeetingSyncTrigger,
} from "@/db/schema";
import { forgetTestArtifact, outboundCohort, testArtifacts } from "@/lib/cohorts/test-group";
import { PAGE_SIZE } from "@/lib/paging";
import {
  assessmentAdministratorEmails,
  getMeetingSyncLive,
  googleConnection,
  meetingBootcamp,
  meetingSelectionsAfter,
  SYNC_STALE_MS,
  upcomingSyncedGuests,
  type GoogleConnection,
} from "@/lib/evals/google-meetings";
import {
  administratorsFor,
  inviteWindowLabel,
  joinedFrom,
  meetingKey,
  mergeAttendees,
  planMeeting,
  sameGuests,
  windowsFor,
  zoomMeetingIdIn,
  type CalendarAttendee,
  type CalendarEvent,
  type MeetingBootcamp,
  type PlanInvite,
  type PlanOccurrence,
  type ZoomParticipant,
} from "@/lib/evals/meeting-plan";
import { accessToken, calendarClient, GoogleError, oauthClient, type CalendarClient } from "@/lib/google-calendar";
import { openSecret } from "@/lib/secret-box";
import { classDate } from "@/lib/evals/attendance";
import { ZoomError, type ZoomClient } from "@/lib/zoom";
import { connectedZoom } from "@/lib/zoom-connection";

/** The calendar the meetings are picked from, and invites sent on. */
export const REVENUE_ENABLEMENT_CALENDAR_ID = "c_3pt3qoc60a1cn5lre92sc9r7s0@group.calendar.google.com";

/** How far ahead the calendar is read: the names offered, and the occurrences invited to. */
export const CALENDAR_WINDOW_DAYS = 60;

/** How long after an occurrence ends Zoom is asked who joined, so its report is complete. */
const ATTENDANCE_DELAY_MS = 30 * 60_000;

const DAY_MS = 24 * 60 * 60_000;

const enc = encodeURIComponent;

/* ------------------------------------------------------------------ */
/* Google                                                              */
/* ------------------------------------------------------------------ */

export type MeetingSyncError = "already_running" | "not_configured" | "not_connected" | "revoked" | "google_error";

export const SYNC_STATUS_FOR: Record<MeetingSyncError, number> = {
  already_running: 409,
  not_configured: 409,
  not_connected: 409,
  revoked: 409,
  google_error: 502,
};

type Connected = { ok: true; connection: GoogleConnection; calendar: CalendarClient };
type NotConnected = { ok: false; error: Exclude<MeetingSyncError, "already_running">; message: string };

/** The connected account's Calendar API, or why there is none. */
async function connect(): Promise<Connected | NotConnected> {
  const client = oauthClient();
  if (!client) return { ok: false, error: "not_configured", message: "AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET are not set." };
  const connection = await googleConnection();
  if (!connection) {
    return { ok: false, error: "not_connected", message: "No Google account is connected — connect one on Admin Settings → External Connectors." };
  }
  const refreshToken = openSecret(connection.refreshToken);
  if (!refreshToken) {
    return { ok: false, error: "revoked", message: "The stored Google token cannot be opened here. Connect the account again." };
  }
  try {
    return { ok: true, connection, calendar: calendarClient(await accessToken(client, refreshToken)) };
  } catch (err) {
    if (err instanceof GoogleError && err.revoked) {
      return { ok: false, error: "revoked", message: `Google no longer accepts ${connection.email}'s token. Connect the account again.` };
    }
    return { ok: false, error: "google_error", message: (err as Error).message };
  }
}

const events = `/calendars/${enc(REVENUE_ENABLEMENT_CALENDAR_ID)}/events`;

type Listed = { timeZone: string; events: CalendarEvent[] };

/**
 * Every timed event on the calendar from `from` to `to`, recurring ones as
 * their instances, soonest first. One under way at `from` is included; all-day
 * events and cancelled instances are not.
 */
async function listEvents(calendar: CalendarClient, from: Date, to: Date): Promise<Listed> {
  const out: CalendarEvent[] = [];
  let timeZone = "UTC";
  let pageToken: string | undefined;
  do {
    const page = await calendar.call<{ items?: CalendarEvent[]; nextPageToken?: string; timeZone?: string }>("GET", events, {
      query: {
        singleEvents: "true",
        orderBy: "startTime",
        timeMin: from.toISOString(),
        timeMax: to.toISOString(),
        maxResults: "2500",
        ...(pageToken ? { pageToken } : {}),
      },
    });
    timeZone = page.timeZone ?? timeZone;
    for (const event of page.items ?? []) {
      if (event.status !== "cancelled" && event.start?.dateTime && event.end?.dateTime && event.summary?.trim()) out.push(event);
    }
    pageToken = page.nextPageToken;
  } while (pageToken);
  return { timeZone, events: out };
}

/** `YYYY-MM-DD` of an instant in a time zone. */
function dayIn(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
}

export type CalendarMeetingName = { name: string; next: Date; occurrences: number };

/** The names of the meetings on the calendar in the next 60 days, each once, with when it next starts; for the picker. */
export async function upcomingMeetingNames(): Promise<
  { ok: true; names: CalendarMeetingName[] } | { ok: false; error: Exclude<MeetingSyncError, "already_running">; message: string }
> {
  const connected = await connect();
  if (!connected.ok) return connected;
  try {
    const now = new Date();
    const { events: listed } = await listEvents(connected.calendar, now, new Date(now.getTime() + CALENDAR_WINDOW_DAYS * DAY_MS));
    const byKey = new Map<string, CalendarMeetingName>();
    for (const event of listed) {
      const key = meetingKey(event.summary!);
      const seen = byKey.get(key);
      if (seen) seen.occurrences++;
      else byKey.set(key, { name: event.summary!.trim().replace(/\s+/g, " "), next: new Date(event.start!.dateTime!), occurrences: 1 });
    }
    return { ok: true, names: [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name)) };
  } catch (err) {
    return googleFailure(err, connected.connection.email);
  }
}

function googleFailure(err: unknown, account: string): NotConnected {
  if (err instanceof GoogleError && err.revoked) {
    return { ok: false, error: "revoked", message: `Google no longer accepts ${account}'s token. Connect the account again.` };
  }
  if (err instanceof GoogleError && (err.status === 403 || err.status === 404)) {
    return {
      ok: false,
      error: "google_error",
      message: `${account} cannot change the Revenue Enablement calendar. Share it with that account, with "Make changes to events": ${(err as Error).message}`,
    };
  }
  return { ok: false, error: "google_error", message: (err as Error).message };
}

/** Sets an event's guests without emailing anyone; Google numbers each instance of a recurring one on its own. */
async function patchGuests(calendar: CalendarClient, eventId: string, attendees: CalendarAttendee[]): Promise<void> {
  await calendar.call("PATCH", `${events}/${enc(eventId)}`, { query: { sendUpdates: "none" }, body: { attendees } });
}

/** Takes `emails` off one event, leaving everyone else; an event gone already has no one to take off. */
async function takeOff(calendar: CalendarClient, eventId: string, emails: readonly string[]): Promise<void> {
  let event: CalendarEvent;
  try {
    event = await calendar.call<CalendarEvent>("GET", `${events}/${enc(eventId)}`);
  } catch (err) {
    if (err instanceof GoogleError && err.gone) return;
    throw err;
  }
  const current = event.attendees ?? [];
  const next = mergeAttendees(current, [], emails);
  if (!sameGuests(current, next)) await patchGuests(calendar, eventId, next);
}

/* ------------------------------------------------------------------ */
/* The run log                                                         */
/* ------------------------------------------------------------------ */

async function closeStaleRuns(): Promise<void> {
  await db
    .update(meetingSyncRuns)
    .set({ status: "failed", finishedAt: new Date(), error: "Did not finish — the server stopped mid-sync." })
    .where(and(eq(meetingSyncRuns.status, "running"), lt(meetingSyncRuns.startedAt, new Date(Date.now() - SYNC_STALE_MS))));
}

/** Opens a run, or null if one is already running — the partial unique index allows one. */
async function startRun(trigger: MeetingSyncTrigger, actorId: string | null, dryRun: boolean, testGroup: boolean): Promise<string | null> {
  await closeStaleRuns();
  const [run] = await db
    .insert(meetingSyncRuns)
    .values({ trigger, triggeredBy: actorId, dryRun, testGroup })
    .onConflictDoNothing()
    .returning({ id: meetingSyncRuns.id });
  return run?.id ?? null;
}

type Tally = { invited: number; removed: number; attended: number; missed: number; noneLeft: number; failures: number };

type ChangeRow = { meetingName: string; occurrenceStartsAt?: Date | null; action: MeetingSyncAction; email?: string; detail?: string | null; at?: Date };

const TALLIED: Partial<Record<MeetingSyncAction, keyof Tally>> = {
  invited: "invited",
  removed: "removed",
  attended: "attended",
  missed: "missed",
  none_left: "noneLeft",
  failed: "failures",
};

/** What a run has done so far, written out a meeting at a time so a cut-off run still shows its work. */
class RunLog {
  readonly tally: Tally = { invited: 0, removed: 0, attended: 0, missed: 0, noneLeft: 0, failures: 0 };
  private pending: ChangeRow[] = [];
  /** Each change is a millisecond after the one before, so the log lists them in the order they happened. */
  private lastAt = 0;
  constructor(readonly runId: string) {}

  get size(): number {
    return Object.values(this.tally).reduce((a, b) => a + b, 0) + this.cancelled;
  }

  private cancelled = 0;

  note(row: ChangeRow): void {
    this.lastAt = Math.max(Date.now(), this.lastAt + 1);
    this.pending.push({ ...row, at: new Date(this.lastAt) });
    const key = TALLIED[row.action];
    if (key) this.tally[key]++;
    else this.cancelled++;
  }

  async flush(): Promise<void> {
    const rows = this.pending;
    this.pending = [];
    for (let n = 0; n < rows.length; n += 500) {
      await db.insert(meetingSyncChanges).values(
        rows.slice(n, n + 500).map((row) => ({
          runId: this.runId,
          meetingName: row.meetingName,
          occurrenceStartsAt: row.occurrenceStartsAt ?? null,
          action: row.action,
          email: row.email ?? "",
          detail: row.detail?.slice(0, 1_000) ?? null,
          at: row.at,
        })),
      );
    }
  }
}

async function finishRun(
  runId: string,
  status: Exclude<MeetingSyncStatus, "running">,
  fields: Partial<Tally> & { unfinished?: boolean; error?: string | null; notes?: string[] },
): Promise<void> {
  await db
    .update(meetingSyncRuns)
    .set({ status, finishedAt: new Date(), ...fields })
    .where(eq(meetingSyncRuns.id, runId));
}

/* ------------------------------------------------------------------ */
/* Zoom attendance                                                     */
/* ------------------------------------------------------------------ */

/** Zoom's path segment for a past meeting's UUID, which must be encoded twice when it starts with `/` or holds `//`. */
function zoomUuid(uuid: string): string {
  return uuid.startsWith("/") || uuid.includes("//") ? enc(enc(uuid)) : enc(uuid);
}

/**
 * Who joined the Zoom meeting held for an occurrence, or null when Zoom has
 * no session of it near that time — no one started it — and so no one joined.
 */
async function zoomJoiners(zoom: ZoomClient, zoomMeetingId: string, startsAt: Date, endsAt: Date): Promise<ZoomParticipant[] | null> {
  const instances = await zoom.call<{ meetings?: { uuid: string; start_time: string }[] }>(
    "GET",
    `/past_meetings/${enc(zoomMeetingId)}/instances`,
  );
  // A session started up to an hour early, or before the slot ended, is this occurrence's.
  const held = (instances?.meetings ?? []).filter((m) => {
    const at = Date.parse(m.start_time);
    return at >= startsAt.getTime() - 60 * 60_000 && at <= endsAt.getTime();
  });
  if (held.length === 0) return null;
  const participants: ZoomParticipant[] = [];
  for (const session of held) {
    let token = "";
    do {
      const page = await zoom.call<{ participants?: ZoomParticipant[]; next_page_token?: string }>(
        "GET",
        `/past_meetings/${zoomUuid(session.uuid)}/participants?page_size=300${token ? `&next_page_token=${enc(token)}` : ""}`,
      );
      participants.push(...(page?.participants ?? []));
      token = page?.next_page_token ?? "";
    } while (token);
  }
  return participants;
}

/* ------------------------------------------------------------------ */
/* One meeting                                                         */
/* ------------------------------------------------------------------ */

type Occurrence = {
  id: string;
  eventId: string;
  startsAt: Date;
  endsAt: Date;
  startDate: string;
  zoomMeetingId: string | null;
  attendanceReadAt: Date | null;
  /** As listed this run; absent for one over, or past the window. */
  event?: CalendarEvent;
};

type Invite = PlanInvite & { test: boolean; responseStatus: string | null };

type Context = {
  calendar: CalendarClient;
  zoom: ZoomClient | null;
  dryRun: boolean;
  testGroup: boolean;
  now: Date;
  timeZone: string;
  listed: CalendarEvent[];
  cohort: {
    email: string;
    fullName: string;
    stage: "bootcamp" | "intermediate";
    track: "sales" | "engineer";
    timezone?: string | null;
    startDate?: string | null;
    rsvpd?: boolean;
    btcDate?: string | null;
  }[];
  administrators: string[];
  /** The active bootcamp, which decides each person's window; with none the run stops before planning. */
  bootcamp: MeetingBootcamp | null;
  log: RunLog;
  notes: string[];
  /** Notes said once a run, not once a meeting. */
  noted: Set<string>;
};

function noteOnce(ctx: Context, key: string, text: string): void {
  if (ctx.noted.has(key)) return;
  ctx.noted.add(key);
  ctx.notes.push(text);
}

/**
 * The meeting's occurrences: those stored, brought up to date with the
 * calendar, and those new on it. One still to start that is no longer on the
 * calendar was cancelled or moved, and goes. A dry run does this too: they are
 * the app's own copy of the calendar, and the Current tab lists them.
 */
async function occurrencesOf(ctx: Context, meeting: MeetingSelection): Promise<Occurrence[]> {
  const key = meetingKey(meeting.name);
  const listed = ctx.listed.filter((e) => meetingKey(e.summary!) === key);
  const byEvent = new Map(listed.map((e) => [e.id, e]));
  const fields = (e: CalendarEvent) => {
    const startsAt = new Date(e.start!.dateTime!);
    return {
      eventId: e.id,
      startsAt,
      endsAt: new Date(e.end!.dateTime!),
      startDate: dayIn(startsAt, ctx.timeZone),
      zoomMeetingId: zoomMeetingIdIn(e.location, e.description, ...(e.conferenceData?.entryPoints ?? []).map((p) => p.uri)),
    };
  };

  if (listed.length > 0) {
    await db
      .insert(meetingOccurrences)
      .values(listed.map((e) => ({ meetingId: meeting.id, ...fields(e) })))
      .onConflictDoUpdate({
        target: [meetingOccurrences.meetingId, meetingOccurrences.eventId],
        set: {
          startsAt: sql`excluded.starts_at`,
          endsAt: sql`excluded.ends_at`,
          startDate: sql`excluded.start_date`,
          zoomMeetingId: sql`excluded.zoom_meeting_id`,
        },
      });
  }
  await db
    .delete(meetingOccurrences)
    .where(
      and(
        eq(meetingOccurrences.meetingId, meeting.id),
        gt(meetingOccurrences.startsAt, ctx.now),
        listed.length > 0 ? notInArray(meetingOccurrences.eventId, listed.map((e) => e.id)) : undefined,
      ),
    );

  const stored = await db
    .select()
    .from(meetingOccurrences)
    .where(eq(meetingOccurrences.meetingId, meeting.id))
    .orderBy(meetingOccurrences.startsAt)
    .limit(1_000);
  return stored.map((row) => ({ ...row, event: byEvent.get(row.eventId) }));
}

async function invitesOn(occurrences: readonly Occurrence[]): Promise<Invite[]> {
  const ids = occurrences.map((occ) => occ.id);
  if (ids.length === 0) return [];
  const rows = await db
    .select({
      occurrenceId: meetingInvites.occurrenceId,
      email: meetingInvites.email,
      role: meetingInvites.role,
      addedBySync: meetingInvites.addedBySync,
      attendance: meetingInvites.attendance,
      test: meetingInvites.test,
      responseStatus: meetingInvites.responseStatus,
    })
    .from(meetingInvites)
    .where(inArray(meetingInvites.occurrenceId, ids))
    .limit(50_000);
  return rows;
}

/** Copies each guest's reply from the calendar onto the invite the sync holds for them. */
async function storeReplies(occurrences: readonly Occurrence[], invites: Invite[], persist: boolean): Promise<void> {
  for (const occ of occurrences) {
    if (!occ.event) continue;
    const replies = new Map((occ.event.attendees ?? []).map((a) => [a.email.trim().toLowerCase(), a.responseStatus ?? null]));
    const changed = invites
      .filter((inv) => inv.occurrenceId === occ.id && replies.has(inv.email) && replies.get(inv.email) !== inv.responseStatus)
      .map((inv) => ({ email: inv.email, status: replies.get(inv.email) ?? null }));
    if (changed.length === 0) continue;
    if (persist) {
      await db.execute(sql`
        update meeting_invites i set response_status = x.status
        from jsonb_to_recordset(${JSON.stringify(changed)}::jsonb) as x(email text, status text)
        where i.occurrence_id = ${occ.id}::uuid and i.email = x.email`);
    }
    for (const inv of invites) if (inv.occurrenceId === occ.id && replies.has(inv.email)) inv.responseStatus = replies.get(inv.email) ?? null;
  }
}

/**
 * Reads who joined each occurrence over for half an hour whose attendance is
 * not known, and marks each of the run's members invited to it attended or
 * missed. One with no Zoom link, or that Zoom will not report on, stays
 * unknown until an administrator marks it on the Current tab.
 *
 * A run reads only its own mode's invites, the test group's or the cohort's,
 * so an occurrence is marked read only once every member invited to it, in
 * either mode, has an answer. Otherwise a test-group run would leave the
 * cohort's invites unread for good, and the plan would count them missed.
 */
async function readAttendance(ctx: Context, meeting: MeetingSelection, occurrences: Occurrence[], invites: Invite[]): Promise<void> {
  const mode = invites.filter((inv) => inv.test === ctx.testGroup && inv.role === "member");
  const due = occurrences.filter(
    (occ) =>
      occ.attendanceReadAt === null &&
      occ.endsAt.getTime() + ATTENDANCE_DELAY_MS <= ctx.now.getTime() &&
      mode.some((inv) => inv.occurrenceId === occ.id && inv.attendance === null),
  );
  if (due.length === 0) return;
  if (!ctx.zoom) {
    noteOnce(ctx, "no-zoom", "No Zoom user is connected, so who attended was not read. Connect one on Admin Settings → External Connectors, or mark attendance on the Cohorts page's Current tab.");
    return;
  }
  const names = new Map(ctx.cohort.map((m) => [m.email, m.fullName]));
  for (const occ of due) {
    if (!occ.zoomMeetingId) {
      noteOnce(ctx, `no-link:${meeting.id}`, `"${meeting.name}" has no Zoom link on the calendar, so who attended is not known. Mark attendance on the Cohorts page's Current tab.`);
      continue;
    }
    let joined: Set<string> | null;
    try {
      const participants = await zoomJoiners(ctx.zoom, occ.zoomMeetingId, occ.startsAt, occ.endsAt);
      const invited = mode.filter((inv) => inv.occurrenceId === occ.id).map((inv) => ({ email: inv.email, fullName: names.get(inv.email) ?? "" }));
      joined = participants === null ? new Set() : joinedFrom(participants, invited);
      if (participants === null) {
        noteOnce(ctx, `not-held:${occ.id}`, `Zoom has no record of "${meeting.name}" being held on ${occ.startDate}, so everyone invited to it is counted as missing it.`);
      }
    } catch (err) {
      if (!(err instanceof ZoomError)) throw err;
      noteOnce(
        ctx,
        `zoom:${meeting.id}`,
        err.status === 401 || err.status === 403 || err.code === 4711
          ? `Zoom would not report who joined "${meeting.name}": the Zoom app needs the meeting:read:list_past_instances and meeting:read:list_past_participants scopes, and the connected user must host the meeting. Mark attendance on the Current tab meanwhile. (${err.message})`
          : `Zoom would not report who joined "${meeting.name}": ${err.message}`,
      );
      continue;
    }
    const read: { email: string; attendance: MeetingAttendance }[] = [];
    for (const inv of mode) {
      if (inv.occurrenceId !== occ.id || inv.attendance !== null) continue;
      const attendance: MeetingAttendance = joined.has(inv.email) ? "attended" : "missed";
      inv.attendance = attendance;
      read.push({ email: inv.email, attendance });
      ctx.log.note({ meetingName: meeting.name, occurrenceStartsAt: occ.startsAt, action: attendance, email: inv.email });
    }
    const allRead = invites.every((inv) => inv.occurrenceId !== occ.id || inv.role !== "member" || inv.attendance !== null);
    if (allRead) occ.attendanceReadAt = ctx.now;
    if (!ctx.dryRun) {
      if (read.length > 0) {
        await db.execute(sql`
          update meeting_invites i set attendance = x.attendance
          from jsonb_to_recordset(${JSON.stringify(read)}::jsonb) as x(email text, attendance text)
          where i.occurrence_id = ${occ.id}::uuid and i.email = x.email`);
      }
      if (allRead) await db.update(meetingOccurrences).set({ attendanceReadAt: ctx.now }).where(eq(meetingOccurrences.id, occ.id));
    }
  }
}

async function syncMeeting(ctx: Context, meeting: MeetingSelection): Promise<void> {
  const occurrences = await occurrencesOf(ctx, meeting);
  const invites = await invitesOn(occurrences);
  // A dry run stores nothing, but its plan still reads the replies, so it logs what a live run would do about a decline.
  await storeReplies(occurrences, invites, !ctx.dryRun);
  await readAttendance(ctx, meeting, occurrences, invites);

  const byId = new Map(occurrences.map((occ) => [occ.id, occ]));
  const upcoming = occurrences.filter((occ) => occ.startsAt > ctx.now);
  if (!occurrences.some((occ) => occ.event)) {
    ctx.notes.push(`No event named "${meeting.name}" is on the Revenue Enablement calendar in the next ${CALENDAR_WINDOW_DAYS} days.`);
  }

  const marks = new Map(
    (
      await db
        .select({ email: meetingAttendanceMarks.email, attended: meetingAttendanceMarks.attended })
        .from(meetingAttendanceMarks)
        .where(eq(meetingAttendanceMarks.meetingId, meeting.id))
        .limit(10_000)
    ).map((m) => [m.email, m.attended]),
  );
  const mode = invites.filter((inv) => inv.test === ctx.testGroup);
  // With no bootcamp active the run stops before here; the guard is for the type.
  const bootcamp = ctx.bootcamp ?? { startDate: "9999-12-31", lastDay: "9999-12-31", nextIntermediate: null };
  // Offsets change with daylight saving, so who is in a range is read at the next occurrence, not today.
  const windows = windowsFor(
    meeting,
    ctx.cohort,
    bootcamp,
    upcoming.reduce((first, occ) => (occ.startsAt < first ? occ.startsAt : first), upcoming[0]?.startsAt ?? ctx.now),
  );
  const plan = planMeeting({
    audience: [...windows.keys()],
    occurrences: occurrences.map(
      (occ): PlanOccurrence => ({ id: occ.id, startsAt: occ.startsAt, startDate: occ.startDate, attendanceRead: occ.attendanceReadAt !== null }),
    ),
    invites: mode,
    marks,
    now: ctx.now,
    cutoff: bootcamp.startDate,
    windows,
    allOccurrences: meeting.allOccurrences,
    minDaysAfterStart: meeting.minDaysAfterStart,
    startDates: new Map(ctx.cohort.map((m) => [m.email.trim().toLowerCase(), m.startDate ?? null])),
  });

  // Who should be on each upcoming occurrence once the plan is carried out, in this mode.
  const add: { occurrenceId: string; email: string; role: MeetingInviteRole }[] = [];
  const drop = new Set(plan.remove.map((inv) => `${inv.occurrenceId} ${inv.email}`));
  for (const inv of plan.invite) {
    add.push({ occurrenceId: inv.occurrenceId, email: inv.email, role: "member" });
    ctx.log.note({
      meetingName: meeting.name,
      occurrenceStartsAt: byId.get(inv.occurrenceId)!.startsAt,
      action: "invited",
      email: inv.email,
      detail: inv.afterDecline ? "Declined an earlier one." : inv.afterMiss ? "Missed an earlier one." : null,
    });
  }
  for (const [email, outcome] of plan.outcomes) {
    if (outcome.kind !== "none_left") continue;
    const window = windows.get(email);
    ctx.log.note({
      meetingName: meeting.name,
      action: "none_left",
      email,
      detail: `No occurrence is left ${window ? inviteWindowLabel(window) : `before the bootcamp starts on ${bootcamp.startDate}`}.`,
    });
  }
  for (const inv of plan.remove) {
    ctx.log.note({ meetingName: meeting.name, occurrenceStartsAt: byId.get(inv.occurrenceId)?.startsAt, action: "removed", email: inv.email });
  }

  const membersOn = new Map<string, Set<string>>();
  for (const inv of [...mode.filter((inv) => inv.role === "member" && !drop.has(`${inv.occurrenceId} ${inv.email}`)), ...add]) {
    if (!byId.has(inv.occurrenceId) || byId.get(inv.occurrenceId)!.startsAt <= ctx.now) continue;
    membersOn.set(inv.occurrenceId, (membersOn.get(inv.occurrenceId) ?? new Set()).add(inv.email));
  }
  if (!ctx.testGroup) {
    const admins = administratorsFor(
      upcoming.map((occ) => occ.id),
      membersOn,
      ctx.administrators,
    );
    for (const occ of upcoming) {
      const want = new Set(admins.get(occ.id) ?? []);
      const have = mode.filter((inv) => inv.occurrenceId === occ.id && inv.role === "administrator");
      for (const email of want) if (!have.some((inv) => inv.email === email)) add.push({ occurrenceId: occ.id, email, role: "administrator" });
      for (const inv of have) if (!want.has(inv.email) && inv.attendance === null) drop.add(`${inv.occurrenceId} ${inv.email}`);
    }
  }

  // One call to each upcoming occurrence whose guests change.
  for (const occ of upcoming) {
    const adding = add.filter((a) => a.occurrenceId === occ.id);
    const dropping = invites.filter((inv) => inv.occurrenceId === occ.id && drop.has(`${occ.id} ${inv.email}`));
    if (adding.length === 0 && dropping.length === 0) continue;
    if (ctx.dryRun) continue;
    if (!occ.event) {
      // Past the window, or gone from the calendar since it was read: next run.
      continue;
    }
    const current = occ.event.attendees ?? [];
    const onAlready = new Set(current.map((a) => a.email.trim().toLowerCase()));
    const kept = invites.filter((inv) => inv.occurrenceId === occ.id && !drop.has(`${occ.id} ${inv.email}`)).map((inv) => inv.email);
    const next = mergeAttendees(
      current,
      [...kept, ...adding.map((a) => a.email)],
      invites.filter((inv) => inv.occurrenceId === occ.id && inv.addedBySync).map((inv) => inv.email),
    );
    try {
      if (!sameGuests(current, next)) await patchGuests(ctx.calendar, occ.eventId, next);
    } catch (err) {
      if (err instanceof GoogleError && err.revoked) throw err;
      ctx.log.note({ meetingName: meeting.name, occurrenceStartsAt: occ.startsAt, action: "failed", detail: (err as Error).message });
      continue;
    }
    if (adding.length > 0) {
      await db
        .insert(meetingInvites)
        .values(
          adding.map((a) => ({
            occurrenceId: occ.id,
            email: a.email,
            role: a.role,
            addedBySync: !onAlready.has(a.email),
            test: ctx.testGroup,
            responseStatus: current.find((g) => g.email.trim().toLowerCase() === a.email)?.responseStatus ?? null,
          })),
        )
        .onConflictDoNothing();
    }
    if (dropping.length > 0) {
      await db
        .delete(meetingInvites)
        .where(and(eq(meetingInvites.occurrenceId, occ.id), inArray(meetingInvites.email, dropping.map((inv) => inv.email))));
    }
  }

  if (!ctx.dryRun) await db.update(meetingSelections).set({ syncedAt: ctx.now }).where(eq(meetingSelections.id, meeting.id));
}

/* ------------------------------------------------------------------ */
/* The old create-a-meeting flow                                       */
/* ------------------------------------------------------------------ */

/**
 * Cancels the upcoming invites and Zoom meetings the old flow made, without
 * emailing their guests, and forgets every meeting it made. A dry run lists those it
 * would cancel. One Google or Zoom refuses stays, and is tried next run.
 */
async function cancelLegacyMeetings(ctx: Context, calendarId: string | null): Promise<void> {
  const rows: GoogleMeeting[] = await db.select().from(googleMeetings).orderBy(googleMeetings.startsAt).limit(1_000);
  for (const meeting of rows) {
    const endsAt = new Date(meeting.startsAt.getTime() + meeting.durationMinutes * 60_000);
    const live = endsAt > ctx.now && (meeting.googleEventId || meeting.zoomMeetingId);
    if (live) ctx.log.note({ meetingName: meeting.title, occurrenceStartsAt: meeting.startsAt, action: "cancelled", detail: "Made by the old create-a-meeting flow." });
    if (ctx.dryRun) continue;
    try {
      if (live && meeting.googleEventId && calendarId) {
        await ctx.calendar
          .call("DELETE", `/calendars/${enc(calendarId)}/events/${enc(meeting.googleEventId)}`, { query: { sendUpdates: "none" } })
          .catch((err) => {
            if (!(err instanceof GoogleError && err.gone)) throw err;
          });
      }
      if (live && meeting.zoomMeetingId && ctx.zoom) {
        await ctx.zoom.call("DELETE", `/meetings/${enc(meeting.zoomMeetingId)}`).catch((err) => {
          if (!(err instanceof ZoomError && err.gone)) throw err;
        });
      }
    } catch (err) {
      if (err instanceof GoogleError && err.revoked) throw err;
      ctx.log.note({ meetingName: meeting.title, occurrenceStartsAt: meeting.startsAt, action: "failed", detail: (err as Error).message });
      continue;
    }
    await db.delete(googleMeetings).where(eq(googleMeetings.id, meeting.id));
  }
}

/* ------------------------------------------------------------------ */
/* The sync                                                            */
/* ------------------------------------------------------------------ */

export type MeetingSyncResult =
  | ({
      ok: true;
      runId: string;
      status: "succeeded" | "skipped";
      dryRun: boolean;
      testGroup: boolean;
      unfinished: boolean;
      notes: string[];
    } & Tally)
  | { ok: false; runId: string | null; error: MeetingSyncError; detail?: string };

/** `cohort` with each person's time zone and start date from the employee record, for the test group, which carries neither. */
async function withEmployeeRecord<T extends { email: string }>(cohort: readonly T[]): Promise<(T & { timezone: string | null; startDate: string | null })[]> {
  const emails = [...new Set(cohort.map((m) => m.email))];
  if (emails.length === 0) return [];
  const rows = await db
    .select({ email: sql<string>`lower(${employees.email})`, timezone: employees.timezone, startDate: employees.startDate })
    .from(employees)
    .where(inArray(sql`lower(${employees.email})`, emails))
    .limit(PAGE_SIZE);
  const records = new Map(rows.map((r) => [r.email, r]));
  return cohort.map((m) => ({ ...m, timezone: records.get(m.email)?.timezone ?? null, startDate: records.get(m.email)?.startDate ?? null }));
}

/**
 * `cohort` with whether each person RSVP'd to the coming bootcamp (saved its
 * intake form, in this run's mode) and the day of the latest Bootcamp class
 * they attended, which together decide when an Intermediate meeting is theirs.
 */
async function withClassRecord<T extends { email: string }>(
  cohort: readonly T[],
  test: boolean,
): Promise<(T & { rsvpd: boolean; btcDate: string | null })[]> {
  const emails = [...new Set(cohort.map((m) => m.email.trim().toLowerCase()))];
  const rsvpd = new Set<string>();
  const btcDates = new Map<string, string | null>();
  for (let n = 0; n < emails.length; n += PAGE_SIZE) {
    const batch = emails.slice(n, n + PAGE_SIZE);
    const [rsvps, classes] = await Promise.all([
      db
        .selectDistinct({ email: intakeResponses.email })
        .from(intakeResponses)
        .where(and(eq(intakeResponses.form, "bootcamp"), eq(intakeResponses.test, test), inArray(intakeResponses.email, batch)))
        .limit(PAGE_SIZE),
      db
        .select({ email: sql<string>`lower(${employees.email})`, btcDate: classDate("bootcamp", sql`lower(${employees.email})`) })
        .from(employees)
        .where(inArray(sql`lower(${employees.email})`, batch))
        .limit(PAGE_SIZE),
    ]);
    for (const r of rsvps) rsvpd.add(r.email);
    for (const r of classes) btcDates.set(r.email, r.btcDate);
  }
  return cohort.map((m) => {
    const email = m.email.trim().toLowerCase();
    return { ...m, rsvpd: rsvpd.has(email), btcDate: btcDates.get(email) ?? null };
  });
}

/**
 * One run, logged. `actorId` is whoever pressed the button; `deadline` is when
 * it must stop by, as `Date.now()` counts. `preview` makes it a dry run
 * whether or not the sync is live.
 */
export async function runMeetingSync(
  trigger: MeetingSyncTrigger,
  actorId: string | null,
  deadline: number,
  { preview = false } = {},
): Promise<MeetingSyncResult> {
  const dryRun = preview || !(await getMeetingSyncLive());
  const { cohort: outbound, group } = await outboundCohort();
  // A test group member has no stage or track of their own on record, but their time zone and start date are the employee record's.
  const cohort = await withClassRecord(group.on ? await withEmployeeRecord(outbound) : outbound, group.on);
  const runId = await startRun(trigger, actorId, dryRun, group.on);
  if (!runId) return { ok: false, runId: null, error: "already_running" };

  const notes: string[] = [];
  const log = new RunLog(runId);
  try {
    const connected = await connect();
    if (!connected.ok) {
      await finishRun(runId, "failed", { error: connected.message });
      return { ok: false, runId, error: connected.error, detail: connected.message };
    }
    const { connection, calendar } = connected;
    const now = new Date();
    const bootcamp = await meetingBootcamp();
    const ctx: Context = {
      calendar,
      zoom: (await connectedZoom())?.client ?? null,
      dryRun,
      testGroup: group.on,
      now,
      timeZone: "UTC",
      listed: [],
      cohort,
      administrators: group.on ? [] : await assessmentAdministratorEmails(),
      bootcamp,
      log,
      notes,
      noted: new Set(),
    };
    if (group.on) notes.push("The test group is on, so only its members are invited, and administrators are not.");

    let unfinished = false;
    /** Nothing to sync: no meeting picked, or no bootcamp to invite anyone before. */
    let idle = false;
    try {
      await cancelLegacyMeetings(ctx, connection.calendarId);
      await log.flush();

      const meetings: MeetingSelection[] = [];
      for (let after: string | null = null; ; ) {
        const page = await meetingSelectionsAfter(after);
        meetings.push(...page);
        if (page.length === 0) break;
        after = page.at(-1)!.id;
      }
      idle = meetings.length === 0 || !bootcamp;
      if (meetings.length === 0) notes.push("No meeting is picked yet.");
      else if (!bootcamp) notes.push("No bootcamp is active in the Scheduler, so no one is invited: each person is invited only before their bootcamp starts.");
      else {
        const listed = await listEvents(calendar, now, new Date(now.getTime() + CALENDAR_WINDOW_DAYS * DAY_MS));
        ctx.timeZone = listed.timeZone;
        ctx.listed = listed.events;
        for (const meeting of meetings) {
          if (Date.now() > deadline) {
            unfinished = true;
            break;
          }
          await syncMeeting(ctx, meeting);
          await log.flush();
        }
      }
    } catch (err) {
      if (!(err instanceof GoogleError)) throw err;
      await log.flush();
      const failure = googleFailure(err, connection.email);
      await finishRun(runId, "failed", { ...log.tally, notes, error: failure.message });
      return { ok: false, runId, error: failure.error, detail: failure.message };
    }

    await log.flush();
    const status = idle && log.size === 0 ? "skipped" : "succeeded";
    await finishRun(runId, status, { ...log.tally, unfinished, notes, ...(status === "skipped" && { error: notes.join(" ") }) });
    return { ok: true, runId, status, dryRun, testGroup: group.on, unfinished, notes, ...log.tally };
  } catch (err) {
    // Anything else — the database, most likely — still ends the run.
    await finishRun(runId, "failed", {
      ...log.tally,
      notes,
      error: err instanceof Error ? err.message.slice(0, 500) : "The sync failed.",
    }).catch(() => {});
    throw err;
  }
}

/* ------------------------------------------------------------------ */
/* Taking invites back                                                 */
/* ------------------------------------------------------------------ */

/**
 * Takes everyone the sync put on a meeting's upcoming occurrences off them,
 * without emailing them, before the meeting is deleted or renamed. Nothing to take
 * off needs no Google account.
 */
export async function takeMeetingGuestsOff(
  meetingId: string,
): Promise<{ ok: true; events: number } | { ok: false; error: "not_connected" | "remote_failed"; message: string }> {
  const guests = await upcomingSyncedGuests(meetingId);
  if (guests.length === 0) return { ok: true, events: 0 };
  const connected = await connect();
  if (!connected.ok) return { ok: false, error: "not_connected", message: `Its invites cannot be taken back: ${connected.message}` };
  try {
    for (const { eventId, emails } of guests) await takeOff(connected.calendar, eventId, emails);
    return { ok: true, events: guests.length };
  } catch (err) {
    return { ok: false, error: "remote_failed", message: googleFailure(err, connected.connection.email).message };
  }
}

/**
 * Turning the test group off: takes its members off every upcoming
 * occurrence they were invited to while it was on, and forgets every invite
 * it made. Also cancels any invite and Zoom meeting the old flow made for it.
 * One Google or Zoom refuses is named in `failures` and stays recorded.
 */
export async function cancelTestMeetingInvites(): Promise<{ cancelled: number; failures: string[] }> {
  const failures: string[] = [];
  let cancelled = 0;

  const upcoming = await db
    .select({ occurrenceId: meetingOccurrences.id, eventId: meetingOccurrences.eventId, email: meetingInvites.email, addedBySync: meetingInvites.addedBySync })
    .from(meetingInvites)
    .innerJoin(meetingOccurrences, eq(meetingOccurrences.id, meetingInvites.occurrenceId))
    .where(and(eq(meetingInvites.test, true), gt(meetingOccurrences.startsAt, sql`now()`)))
    .limit(5_000);
  const byEvent = new Map<string, { occurrenceId: string; emails: string[] }>();
  for (const row of upcoming) {
    const entry = byEvent.get(row.eventId) ?? { occurrenceId: row.occurrenceId, emails: [] };
    if (row.addedBySync) entry.emails.push(row.email);
    byEvent.set(row.eventId, entry);
  }
  const kept = new Set<string>();
  if ([...byEvent.values()].some((e) => e.emails.length > 0)) {
    const connected = await connect();
    if (!connected.ok) {
      failures.push(`Test invites could not be taken back: ${connected.message}`);
      for (const { occurrenceId } of byEvent.values()) kept.add(occurrenceId);
    } else {
      for (const [eventId, { occurrenceId, emails }] of byEvent) {
        if (emails.length === 0) continue;
        try {
          await takeOff(connected.calendar, eventId, emails);
          cancelled++;
        } catch (err) {
          failures.push(`${eventId}: ${(err as Error).message}`);
          kept.add(occurrenceId);
        }
      }
    }
  }
  await db
    .delete(meetingInvites)
    .where(and(eq(meetingInvites.test, true), kept.size > 0 ? notInArray(meetingInvites.occurrenceId, [...kept]) : undefined));

  const legacy = await cancelLegacyTestArtifacts();
  return { cancelled: cancelled + legacy.cancelled, failures: [...failures, ...legacy.failures] };
}

/** The invites and Zoom meetings the old flow made for the test group. */
async function cancelLegacyTestArtifacts(): Promise<{ cancelled: number; failures: string[] }> {
  const artifacts = await testArtifacts("calendar_event");
  const zoomMeetings = await testArtifacts("zoom_meeting");
  const failures: string[] = [];
  let cancelled = 0;
  if (artifacts.length === 0 && zoomMeetings.length === 0) return { cancelled, failures };

  const zoom = (await connectedZoom())?.client;
  for (const { key, ref } of zoomMeetings) {
    if (!zoom) {
      failures.push(`${key}: no Zoom user is connected to cancel its Zoom meeting`);
      continue;
    }
    try {
      if (ref) await zoom.call("DELETE", `/meetings/${enc(ref)}`);
    } catch (err) {
      if (!(err instanceof ZoomError && err.gone)) {
        failures.push(`${key}: ${(err as Error).message}`);
        continue;
      }
    }
    await forgetTestArtifact("zoom_meeting", key);
  }
  if (artifacts.length === 0) return { cancelled, failures };

  const connected = await connect();
  if (!connected.ok) return { cancelled, failures: [...failures, `Test invites could not be cancelled: ${connected.message}`] };
  const { connection, calendar } = connected;
  for (const { key, ref } of artifacts) {
    try {
      if (ref && connection.calendarId) {
        await calendar.call("DELETE", `/calendars/${enc(connection.calendarId)}/events/${enc(ref)}`, { query: { sendUpdates: "none" } });
        cancelled++;
      }
    } catch (err) {
      if (!(err instanceof GoogleError && err.gone)) {
        failures.push(`${key}: ${(err as Error).message}`);
        continue;
      }
    }
    await forgetTestArtifact("calendar_event", key);
  }
  return { cancelled, failures };
}
