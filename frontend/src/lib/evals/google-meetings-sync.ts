/**
 * Sync Now on eVals Settings → Google Meetings: brings every meeting still to
 * end in line with Google Calendar and Zoom, as the connected Google account.
 *
 * The invites live on a calendar of their own, "eVals Meetings", which the
 * sync makes on that account the first time it runs. Google Calendar cannot
 * let some guests edit an invite and not others, so each Assessments
 * Administrator gets edit access to that calendar instead: they edit a
 * meeting from it, while the cohort on the invite cannot. The administrators
 * are guests on every invite too.
 *
 * Each meeting gets a Zoom meeting scheduled as the connected Zoom user, with
 * every administrator as an alternative host, and its join link on the
 * invite. The Zoom app is user-managed, so it can reach that user's meetings
 * and nothing else: it cannot look up whether an administrator has a Zoom
 * user, and learns it from Zoom refusing them as a host. Without a connected
 * Zoom user the invites go out with no link, and the result says so.
 *
 * Changing an invite emails every guest, so one already right is left alone.
 * The sync takes off an invite only those it put there; it never takes away
 * calendar access it did not give. A meeting that has ended is never touched.
 */

import "server-only";

import type { GoogleMeeting } from "@/db/schema";
import { forgetTestArtifact, getTestGroup, recordTestArtifact, testArtifacts, type TestGroup } from "@/lib/cohorts/test-group";
import { currentCohortEmails } from "@/lib/evals/current-cohort";
import {
  assessmentAdministratorEmails,
  claimGoogleSync,
  finishGoogleSync,
  googleConnection,
  recordMeetingSync,
  upcomingMeetingsAfter,
  type GoogleConnection,
} from "@/lib/evals/google-meetings";
import {
  endOf,
  eventDiffers,
  eventFields,
  inviteList,
  mergeAttendees,
  zoomDiffers,
  zoomFields,
  type CalendarAttendee,
  type CalendarEvent,
  type CohortMember,
  type ZoomFields,
  type ZoomMeetingState,
} from "@/lib/evals/google-meetings-plan";
import { accessToken, calendarClient, GoogleError, oauthClient, type CalendarClient } from "@/lib/google-calendar";
import { openSecret } from "@/lib/secret-box";
import { ZoomError, type ZoomClient } from "@/lib/zoom";
import { connectedZoom } from "@/lib/zoom-connection";

export const MEETINGS_CALENDAR_NAME = "eVals Meetings";

export type MeetingSyncOutcome = {
  id: string;
  title: string;
  outcome: "created" | "updated" | "unchanged" | "failed";
  invited: number;
  error?: string;
};

export type GoogleSyncFailure = "not_connected" | "not_configured" | "running" | "revoked" | "failed";

export type GoogleSyncResult =
  | { ok: true; account: string; meetings: MeetingSyncOutcome[]; notes: string[] }
  | { ok: false; error: GoogleSyncFailure; message: string };

const enc = encodeURIComponent;

/** The connected account's Calendar API, or why there is none. */
async function connect(): Promise<
  { ok: true; connection: GoogleConnection; calendar: CalendarClient } | { ok: false; error: GoogleSyncFailure; message: string }
> {
  const client = oauthClient();
  if (!client) return { ok: false, error: "not_configured", message: "AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET are not set." };
  const connection = await googleConnection();
  if (!connection) return { ok: false, error: "not_connected", message: "No Google account is connected." };
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
    return { ok: false, error: "failed", message: (err as Error).message };
  }
}

/** The meetings calendar, made when there is none yet or it was deleted. */
async function ensureCalendar(calendar: CalendarClient, id: string | null): Promise<string> {
  if (id) {
    try {
      await calendar.call("GET", `/calendars/${enc(id)}`);
      return id;
    } catch (err) {
      if (!(err instanceof GoogleError && err.gone)) throw err;
    }
  }
  const made = await calendar.call<{ id: string }>("POST", "/calendars", {
    body: {
      summary: MEETINGS_CALENDAR_NAME,
      description: "Invites sent from eVals Settings → Google Meetings. Assessments Administrators can edit them here.",
    },
  });
  return made.id;
}

type AclRule = { id: string; role: string; scope: { type: string; value?: string } };

/**
 * Gives every administrator edit access to the calendar, and takes it from
 * those the sync gave it to who are no longer administrators. Returns whom it
 * has now given access to.
 */
async function shareCalendar(
  calendar: CalendarClient,
  calendarId: string,
  administrators: readonly string[],
  sharedBefore: readonly string[],
  organizer: string,
  notes: string[],
): Promise<string[]> {
  const rules = new Map<string, AclRule>();
  let pageToken: string | undefined;
  do {
    const page = await calendar.call<{ items?: AclRule[]; nextPageToken?: string }>("GET", `/calendars/${enc(calendarId)}/acl`, {
      query: { maxResults: "250", ...(pageToken ? { pageToken } : {}) },
    });
    for (const rule of page.items ?? []) {
      if (rule.scope.type === "user" && rule.scope.value) rules.set(rule.scope.value.toLowerCase(), rule);
    }
    pageToken = page.nextPageToken;
  } while (pageToken);

  const want = new Set(administrators.filter((email) => email !== organizer));
  const shared = new Set(sharedBefore.filter((email) => want.has(email)));

  for (const email of want) {
    const role = rules.get(email)?.role;
    if (role === "writer" || role === "owner") continue;
    try {
      await calendar.call("POST", `/calendars/${enc(calendarId)}/acl`, {
        query: { sendNotifications: "true" },
        body: { role: "writer", scope: { type: "user", value: email } },
      });
      shared.add(email);
    } catch (err) {
      notes.push(`Could not give ${email} edit access to the ${MEETINGS_CALENDAR_NAME} calendar: ${(err as Error).message}`);
    }
  }

  for (const email of sharedBefore) {
    if (want.has(email)) continue;
    const rule = rules.get(email);
    if (rule?.role !== "writer") continue;
    try {
      await calendar.call("DELETE", `/calendars/${enc(calendarId)}/acl/${enc(rule.id)}`);
    } catch (err) {
      if (!(err instanceof GoogleError && err.gone)) {
        shared.add(email);
        notes.push(`Could not take ${email}'s edit access away: ${(err as Error).message}`);
      }
    }
  }
  return [...shared].sort();
}

type Zoomed = { zoomMeetingId: string | null; zoomJoinUrl: string | null };

function zoomBody(fields: ZoomFields) {
  return {
    topic: fields.topic,
    type: 2,
    start_time: fields.startTime,
    timezone: "UTC",
    duration: fields.duration,
    settings: { alternative_hosts: fields.alternativeHosts, alternative_hosts_email_notification: true },
  };
}

const hostList = (hosts: string) => hosts.split(/[;,]/).map((h) => h.trim().toLowerCase()).filter(Boolean);

/**
 * The administrators to ask Zoom to take as alternative hosts, and those it has
 * refused so far in this sync, which later meetings leave out rather than
 * asking again: a refused request changes nothing, so a meeting that could not
 * get everyone would otherwise look out of line, and be patched, on every sync.
 */
type ZoomHosts = { wanted: string[]; refused: Set<string> };

/**
 * Zoom refuses the whole request over one alternative host it will not take,
 * such as an administrator with no user on its account. Fall back to adding the
 * hosts one at a time, keeping those Zoom takes and saying which it did not.
 * `kept` are the hosts the meeting already has that should stay: a refused
 * request changes nothing, so those that are right are never sent again and
 * their people are not emailed on every sync.
 */
async function addHostsOneByOne(
  zoom: ZoomClient,
  meetingId: string,
  fields: ZoomFields,
  kept: string[],
  hosts: ZoomHosts,
  notes: string[],
  title: string,
): Promise<void> {
  const wanted = hostList(fields.alternativeHosts);
  const have = kept.filter((h) => wanted.includes(h));
  if (have.length !== kept.length) {
    await zoom.call("PATCH", `/meetings/${enc(meetingId)}`, zoomBody({ ...fields, alternativeHosts: have.join(";") }));
  }
  for (const host of wanted.filter((h) => !have.includes(h))) {
    try {
      await zoom.call("PATCH", `/meetings/${enc(meetingId)}`, zoomBody({ ...fields, alternativeHosts: [...have, host].join(";") }));
      have.push(host);
    } catch (err) {
      if (!(err instanceof ZoomError && err.status === 400)) throw err;
      hosts.refused.add(host);
      notes.push(`Zoom would not take ${host} as an alternative host (first refused on “${title}”), so they are not one: ${err.message}`);
    }
  }
}

const refusedHosts = (err: unknown, fields: ZoomFields): err is ZoomError =>
  err instanceof ZoomError && err.status === 400 && /alternative|host/i.test(err.message) && fields.alternativeHosts !== "";

/** Creates or updates the meeting's Zoom meeting; returns its id and join link. */
async function syncZoom(zoom: ZoomClient, meeting: GoogleMeeting, hosts: ZoomHosts, notes: string[]): Promise<Zoomed> {
  const fields = zoomFields(meeting, hosts.wanted.filter((h) => !hosts.refused.has(h)));
  if (meeting.zoomMeetingId) {
    const id = meeting.zoomMeetingId;
    let existing: (ZoomMeetingState & { join_url?: string }) | null = null;
    try {
      existing = await zoom.call("GET", `/meetings/${enc(id)}`);
    } catch (err) {
      if (!(err instanceof ZoomError && err.gone)) throw err;
    }
    if (existing) {
      if (zoomDiffers(existing, fields)) {
        try {
          await zoom.call("PATCH", `/meetings/${enc(id)}`, zoomBody(fields));
        } catch (err) {
          if (!refusedHosts(err, fields)) throw err;
          await addHostsOneByOne(zoom, id, fields, hostList(existing.settings?.alternative_hosts ?? ""), hosts, notes, meeting.title);
        }
      }
      return { zoomMeetingId: id, zoomJoinUrl: existing.join_url ?? meeting.zoomJoinUrl };
    }
  }
  let made: { id: number | string; join_url: string };
  try {
    made = await zoom.call("POST", "/users/me/meetings", zoomBody(fields));
  } catch (err) {
    if (!refusedHosts(err, fields)) throw err;
    made = await zoom.call("POST", "/users/me/meetings", zoomBody({ ...fields, alternativeHosts: "" }));
    // The meeting exists now, so a failure adding hosts is a note, not a failed sync: the next one updates it rather than making another.
    try {
      await addHostsOneByOne(zoom, String(made.id), fields, [], hosts, notes, meeting.title);
    } catch (hostErr) {
      notes.push(`Could not add alternative hosts to “${meeting.title}”: ${(hostErr as Error).message}`);
    }
  }
  return { zoomMeetingId: String(made.id), zoomJoinUrl: made.join_url };
}

type SyncContext = {
  calendar: CalendarClient;
  calendarId: string;
  organizer: string;
  zoom: ZoomClient | null;
  zoomHosts: ZoomHosts;
  cohort: CohortMember[];
  administrators: string[];
  notes: string[];
  /** The test group, while it is on: its people are invited to their own copy of each meeting, and the real invites are left alone. */
  testGroup: TestGroup | null;
};

/**
 * With the test group on, a meeting's invite for the group alone, titled with
 * the group's suffix and carrying the meeting's Zoom link if it has one. The
 * real invite is never changed, so the real cohort hears nothing.
 */
async function syncOneForTestGroup(ctx: SyncContext, group: TestGroup, meeting: GoogleMeeting): Promise<MeetingSyncOutcome> {
  const invitees = [...new Set(group.members.map((m) => m.email.toLowerCase()))].filter((e) => e !== ctx.organizer.toLowerCase()).sort();
  try {
    const fields = eventFields({ ...meeting, title: `${meeting.title} [${group.suffix}]` }, meeting.zoomJoinUrl);
    const events = `/calendars/${enc(ctx.calendarId)}/events`;
    const [stored] = (await testArtifacts("calendar_event")).filter((a) => a.key === meeting.id);
    let current: CalendarEvent | null = null;
    if (stored?.ref) {
      try {
        current = await ctx.calendar.call<CalendarEvent>("GET", `${events}/${enc(stored.ref)}`);
        if (current.status === "cancelled") current = null;
      } catch (err) {
        if (!(err instanceof GoogleError && err.gone)) throw err;
      }
    }
    if (current) {
      const attendees = mergeAttendees(current.attendees ?? [], invitees, (current.attendees ?? []).map((a) => a.email));
      if (!eventDiffers(current, fields, attendees)) return { id: meeting.id, title: meeting.title, outcome: "unchanged", invited: invitees.length };
      await ctx.calendar.call("PATCH", `${events}/${enc(current.id)}`, { query: { sendUpdates: "all" }, body: { ...fields, attendees } });
      return { id: meeting.id, title: meeting.title, outcome: "updated", invited: invitees.length };
    }
    const made = await ctx.calendar.call<{ id: string }>("POST", events, {
      query: { sendUpdates: "all" },
      body: {
        ...fields,
        attendees: invitees.map((email) => ({ email })),
        guestsCanModify: false,
        guestsCanInviteOthers: false,
        guestsCanSeeOtherGuests: true,
        reminders: { useDefault: true },
      },
    });
    await recordTestArtifact("calendar_event", meeting.id, made.id);
    return { id: meeting.id, title: meeting.title, outcome: "created", invited: invitees.length };
  } catch (err) {
    return { id: meeting.id, title: meeting.title, outcome: "failed", invited: invitees.length, error: (err as Error).message };
  }
}

async function syncOne(ctx: SyncContext, meeting: GoogleMeeting): Promise<MeetingSyncOutcome> {
  if (ctx.testGroup) return syncOneForTestGroup(ctx, ctx.testGroup, meeting);
  // Taken before the row was read, so an edit made while this runs still shows as changed.
  const syncedAt = new Date();
  const invitees = inviteList(meeting.groups, ctx.cohort, ctx.administrators, ctx.organizer);
  let zoomed: Zoomed = { zoomMeetingId: meeting.zoomMeetingId, zoomJoinUrl: meeting.zoomJoinUrl };
  try {
    if (ctx.zoom) zoomed = await syncZoom(ctx.zoom, meeting, ctx.zoomHosts, ctx.notes);

    const fields = eventFields(meeting, zoomed.zoomJoinUrl);
    const events = `/calendars/${enc(ctx.calendarId)}/events`;
    let current: CalendarEvent | null = null;
    if (meeting.googleEventId) {
      try {
        current = await ctx.calendar.call<CalendarEvent>("GET", `${events}/${enc(meeting.googleEventId)}`);
        if (current.status === "cancelled") current = null;
      } catch (err) {
        if (!(err instanceof GoogleError && err.gone)) throw err;
      }
    }

    let outcome: MeetingSyncOutcome["outcome"];
    let eventId: string;
    if (current) {
      const attendees: CalendarAttendee[] = mergeAttendees(current.attendees ?? [], invitees, meeting.invitedEmails);
      eventId = current.id;
      if (eventDiffers(current, fields, attendees)) {
        await ctx.calendar.call("PATCH", `${events}/${enc(current.id)}`, {
          query: { sendUpdates: "all" },
          body: { ...fields, attendees },
        });
        outcome = "updated";
      } else {
        outcome = "unchanged";
      }
    } else {
      const made = await ctx.calendar.call<{ id: string }>("POST", events, {
        query: { sendUpdates: "all" },
        body: {
          ...fields,
          attendees: invitees.map((email) => ({ email })),
          guestsCanModify: false,
          guestsCanInviteOthers: false,
          guestsCanSeeOtherGuests: true,
          reminders: { useDefault: true },
        },
      });
      eventId = made.id;
      outcome = "created";
    }

    await recordMeetingSync(meeting.id, { ok: true, syncedAt, googleEventId: eventId, invitedEmails: invitees, ...zoomed });
    return { id: meeting.id, title: meeting.title, outcome, invited: invitees.length };
  } catch (err) {
    const error = (err as Error).message;
    // Keep any Zoom meeting it did make, so the next sync updates it rather than making another.
    await recordMeetingSync(meeting.id, { ok: false, error, ...zoomed });
    return { id: meeting.id, title: meeting.title, outcome: "failed", invited: invitees.length, error };
  }
}

export async function syncGoogleMeetings(): Promise<GoogleSyncResult> {
  if (!oauthClient()) return { ok: false, error: "not_configured", message: "AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET are not set." };
  if (!(await googleConnection())) return { ok: false, error: "not_connected", message: "No Google account is connected." };
  if (!(await claimGoogleSync())) return { ok: false, error: "running", message: "A sync is already running." };

  const connected = await connect();
  if (!connected.ok) {
    await finishGoogleSync({ error: connected.message });
    return connected;
  }
  const { connection, calendar } = connected;

  const notes: string[] = [];
  let calendarId: string | undefined;
  let sharedWith: string[] | undefined;
  try {
    calendarId = await ensureCalendar(calendar, connection.calendarId);
    const administrators = await assessmentAdministratorEmails();
    sharedWith = await shareCalendar(calendar, calendarId, administrators, connection.sharedWith, connection.email, notes);

    const connectedUser = await connectedZoom();
    const zoom = connectedUser?.client ?? null;
    if (!zoom) notes.push("No Zoom user is connected, so the invites have no Zoom link. Connect one on this page, with ZOOM_CLIENT_ID and ZOOM_CLIENT_SECRET set.");
    const group = await getTestGroup();
    const testGroup = group.on ? group : null;
    if (testGroup) notes.push(`The test group is on, so each meeting was sent to the test group alone as “[${testGroup.suffix}]”, with no Zoom meeting of its own; the real invites were left as they were.`);
    const zoomHosts: ZoomHosts = { wanted: zoom && !testGroup ? administrators.filter((email) => email !== connectedUser!.email) : [], refused: new Set() };

    const ctx: SyncContext = {
      calendar,
      calendarId,
      organizer: connection.email,
      zoom,
      zoomHosts,
      cohort: await currentCohortEmails(),
      administrators,
      notes,
      testGroup,
    };

    const meetings: MeetingSyncOutcome[] = [];
    let after: { startsAt: Date; id: string } | null = null;
    for (;;) {
      const page = await upcomingMeetingsAfter(after);
      for (const meeting of page) meetings.push(await syncOne(ctx, meeting));
      const last = page.at(-1);
      if (!last) break;
      after = { startsAt: last.startsAt, id: last.id };
    }

    await finishGoogleSync({ calendarId, sharedWith, error: null });
    return { ok: true, account: connection.email, meetings, notes };
  } catch (err) {
    const message = err instanceof GoogleError && err.revoked ? `Google no longer accepts ${connection.email}'s token. Connect the account again.` : (err as Error).message;
    await finishGoogleSync({ calendarId, sharedWith, error: message });
    return { ok: false, error: err instanceof GoogleError && err.revoked ? "revoked" : "failed", message };
  }
}

/**
 * Cancels a meeting's invite and Zoom meeting, emailing the guests, before it
 * is deleted. A meeting that has ended, or was never synced, has nothing to
 * cancel: its invite stays in everyone's calendar as a record.
 */
export async function cancelGoogleMeeting(
  meeting: GoogleMeeting,
): Promise<{ ok: true } | { ok: false; error: "not_connected" | "remote_failed"; message: string }> {
  if (endOf(meeting).getTime() <= Date.now()) return { ok: true };
  if (!meeting.googleEventId && !meeting.zoomMeetingId) return { ok: true };

  const connected = await connect();
  if (!connected.ok) {
    return { ok: false, error: "not_connected", message: `Its invite cannot be cancelled: ${connected.message}` };
  }
  const { connection, calendar } = connected;
  try {
    if (meeting.googleEventId && connection.calendarId) {
      try {
        await calendar.call("DELETE", `/calendars/${enc(connection.calendarId)}/events/${enc(meeting.googleEventId)}`, {
          query: { sendUpdates: "all" },
        });
      } catch (err) {
        if (!(err instanceof GoogleError && err.gone)) throw err;
      }
    }
    const zoom = (await connectedZoom())?.client;
    if (meeting.zoomMeetingId && zoom) {
      try {
        await zoom.call("DELETE", `/meetings/${enc(meeting.zoomMeetingId)}`);
      } catch (err) {
        if (!(err instanceof ZoomError && err.gone)) throw err;
      }
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: "remote_failed", message: (err as Error).message };
  }
}

/**
 * Cancels every invite the test group made, emailing its guests, and forgets
 * them. One Google refuses is named in `failures` and stays recorded.
 */
export async function cancelTestMeetings(): Promise<{ cancelled: number; failures: string[] }> {
  const artifacts = await testArtifacts("calendar_event");
  const failures: string[] = [];
  let cancelled = 0;
  if (artifacts.length === 0) return { cancelled, failures };

  const connected = await connect();
  if (!connected.ok) return { cancelled, failures: [`Test invites could not be cancelled: ${connected.message}`] };
  const { connection, calendar } = connected;
  for (const { key, ref } of artifacts) {
    try {
      if (ref && connection.calendarId) {
        await calendar.call("DELETE", `/calendars/${enc(connection.calendarId)}/events/${enc(ref)}`, { query: { sendUpdates: "all" } });
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
