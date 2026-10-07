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
 * Each meeting gets a Zoom meeting scheduled under the connected account, with
 * every administrator who has a user on that Zoom account as an alternative
 * host, and its join link on the invite. Without Zoom credentials the invites
 * go out with no link, and the result says so.
 *
 * Changing an invite emails every guest, so one already right is left alone.
 * The sync takes off an invite only those it put there; it never takes away
 * calendar access it did not give. A meeting that has ended is never touched.
 */

import "server-only";

import type { GoogleMeeting } from "@/db/schema";
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
import { zoomClient, zoomCredentials, ZoomError, type ZoomClient } from "@/lib/zoom";

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

/** The administrators Zoom will take as alternative hosts: those with an active user on the account. */
async function zoomHostsAmong(zoom: ZoomClient, administrators: readonly string[], organizer: string, notes: string[]): Promise<string[]> {
  const hosts: string[] = [];
  for (const email of administrators) {
    if (email === organizer) continue;
    try {
      const user = await zoom.call<{ status?: string }>("GET", `/users/${enc(email)}`);
      if (user.status === "active") hosts.push(email);
      else notes.push(`${email} is not an active Zoom user, so is not an alternative host.`);
    } catch (err) {
      if (err instanceof ZoomError && (err.status === 404 || err.code === 1001)) {
        notes.push(`${email} has no user on the Zoom account, so is not an alternative host.`);
      } else {
        notes.push(`Could not look up ${email} on Zoom: ${(err as Error).message}`);
      }
    }
  }
  return hosts;
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

/** Zoom refuses the whole meeting over one alternative host it will not take; fall back to none, and say so. */
async function withHostFallback<T>(fields: ZoomFields, notes: string[], title: string, send: (fields: ZoomFields) => Promise<T>): Promise<T> {
  try {
    return await send(fields);
  } catch (err) {
    if (!(err instanceof ZoomError && err.status === 400 && /alternative/i.test(err.message) && fields.alternativeHosts)) throw err;
    notes.push(`Zoom would not take the alternative hosts for “${title}”, so it has none: ${err.message}`);
    return send({ ...fields, alternativeHosts: "" });
  }
}

/** Creates or updates the meeting's Zoom meeting; returns its id and join link. */
async function syncZoom(zoom: ZoomClient, meeting: GoogleMeeting, organizer: string, hosts: string[], notes: string[]): Promise<Zoomed> {
  const fields = zoomFields(meeting, hosts);
  if (meeting.zoomMeetingId) {
    let existing: (ZoomMeetingState & { join_url?: string }) | null = null;
    try {
      existing = await zoom.call("GET", `/meetings/${enc(meeting.zoomMeetingId)}`);
    } catch (err) {
      if (!(err instanceof ZoomError && err.gone)) throw err;
    }
    if (existing) {
      if (zoomDiffers(existing, fields)) {
        await withHostFallback(fields, notes, meeting.title, (f) =>
          zoom.call("PATCH", `/meetings/${enc(meeting.zoomMeetingId!)}`, zoomBody(f)),
        );
      }
      return { zoomMeetingId: meeting.zoomMeetingId, zoomJoinUrl: existing.join_url ?? meeting.zoomJoinUrl };
    }
  }
  const made = await withHostFallback(fields, notes, meeting.title, (f) =>
    zoom.call<{ id: number | string; join_url: string }>("POST", `/users/${enc(organizer)}/meetings`, zoomBody(f)),
  );
  return { zoomMeetingId: String(made.id), zoomJoinUrl: made.join_url };
}

type SyncContext = {
  calendar: CalendarClient;
  calendarId: string;
  organizer: string;
  zoom: ZoomClient | null;
  zoomHosts: string[];
  cohort: CohortMember[];
  administrators: string[];
  notes: string[];
};

async function syncOne(ctx: SyncContext, meeting: GoogleMeeting): Promise<MeetingSyncOutcome> {
  // Taken before the row was read, so an edit made while this runs still shows as changed.
  const syncedAt = new Date();
  const invitees = inviteList(meeting.groups, ctx.cohort, ctx.administrators, ctx.organizer);
  let zoomed: Zoomed = { zoomMeetingId: meeting.zoomMeetingId, zoomJoinUrl: meeting.zoomJoinUrl };
  try {
    if (ctx.zoom) zoomed = await syncZoom(ctx.zoom, meeting, ctx.organizer, ctx.zoomHosts, ctx.notes);

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

    const creds = zoomCredentials();
    const zoom = creds ? zoomClient(creds) : null;
    if (!zoom) notes.push("Zoom is not set up, so the invites have no Zoom link. Set ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID and ZOOM_CLIENT_SECRET.");
    const zoomHosts = zoom ? await zoomHostsAmong(zoom, administrators, connection.email, notes) : [];

    const ctx: SyncContext = {
      calendar,
      calendarId,
      organizer: connection.email,
      zoom,
      zoomHosts,
      cohort: await currentCohortEmails(),
      administrators,
      notes,
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
    const creds = zoomCredentials();
    if (meeting.zoomMeetingId && creds) {
      try {
        await zoomClient(creds).call("DELETE", `/meetings/${enc(meeting.zoomMeetingId)}`);
      } catch (err) {
        if (!(err instanceof ZoomError && err.gone)) throw err;
      }
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: "remote_failed", message: (err as Error).message };
  }
}
