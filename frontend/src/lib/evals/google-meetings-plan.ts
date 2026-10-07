/**
 * What a Google Meetings sync should send, worked out without touching Google,
 * Zoom or the database: whom each meeting invites, how that list merges with
 * the invite as it stands, and whether the invite needs changing at all. Pure,
 * so the unit suite covers the rules; `google-meetings-sync.ts` does the
 * calling.
 *
 * A meeting invites everyone on the Cohorts page's Current tab in each group
 * it ticks (Bootcamp Sales is the bootcamp stage on the Sales track), and every
 * Assessments Administrator. The sync takes off the invite only those it put
 * there itself; anyone added by hand in Google Calendar stays.
 */

import { MEETING_GROUPS, MEETING_LENGTHS, type MeetingGroup, type MeetingLength } from "@/db/schema";

export const MEETING_GROUP_LABELS: Record<MeetingGroup, string> = {
  bootcamp_sales: "Bootcamp Sales",
  bootcamp_engineer: "Bootcamp Engineers",
  intermediate_sales: "Intermediate Sales",
  intermediate_engineer: "Intermediate Engineers",
};

/** The stage and track each group draws from the Current tab. */
export const MEETING_GROUP_COHORT: Record<MeetingGroup, { stage: "bootcamp" | "intermediate"; track: "sales" | "engineer" }> = {
  bootcamp_sales: { stage: "bootcamp", track: "sales" },
  bootcamp_engineer: { stage: "bootcamp", track: "engineer" },
  intermediate_sales: { stage: "intermediate", track: "sales" },
  intermediate_engineer: { stage: "intermediate", track: "engineer" },
};

export const MEETING_LENGTH_LABELS: Record<MeetingLength, string> = {
  15: "15m",
  30: "30m",
  60: "1 hour",
};

export function isMeetingGroup(value: unknown): value is MeetingGroup {
  return MEETING_GROUPS.includes(value as MeetingGroup);
}

export function isMeetingLength(value: unknown): value is MeetingLength {
  return MEETING_LENGTHS.includes(value as MeetingLength);
}

/** The groups in the order the form lists them, each once. */
export function orderedGroups(groups: readonly MeetingGroup[]): MeetingGroup[] {
  return MEETING_GROUPS.filter((g) => groups.includes(g));
}

export type CohortMember = { email: string; stage: "bootcamp" | "intermediate"; track: "sales" | "engineer" };

const normal = (email: string) => email.trim().toLowerCase();

/**
 * Whom a meeting invites: everyone in its groups and every administrator,
 * lowercased, each once, sorted. The account sending the invite is its
 * organizer, so it is never a guest.
 */
export function inviteList(
  groups: readonly MeetingGroup[],
  cohort: readonly CohortMember[],
  administrators: readonly string[],
  organizer: string,
): string[] {
  const wanted = new Set<string>();
  for (const group of groups) {
    const { stage, track } = MEETING_GROUP_COHORT[group];
    for (const member of cohort) {
      if (member.stage === stage && member.track === track) wanted.add(normal(member.email));
    }
  }
  for (const email of administrators) wanted.add(normal(email));
  wanted.delete(normal(organizer));
  wanted.delete("");
  return [...wanted].sort();
}

/** A guest as Google Calendar returns one; only the fields the sync reads or must keep. */
export type CalendarAttendee = {
  email: string;
  responseStatus?: string;
  displayName?: string;
  optional?: boolean;
  organizer?: boolean;
  self?: boolean;
  comment?: string;
  additionalGuests?: number;
};

/**
 * The guest list to send. Someone already on the invite keeps their entry, and
 * with it their reply; someone wanted and missing is added; someone the last
 * sync added and no longer wanted is taken off. Anyone else on the invite was
 * put there by hand, and stays.
 */
export function mergeAttendees(
  current: readonly CalendarAttendee[],
  wanted: readonly string[],
  previouslyInvited: readonly string[],
): CalendarAttendee[] {
  const want = new Set(wanted.map(normal));
  const ours = new Set(previouslyInvited.map(normal));
  const kept = current.filter((a) => want.has(normal(a.email)) || !ours.has(normal(a.email)));
  const present = new Set(kept.map((a) => normal(a.email)));
  const added = [...want].filter((email) => !present.has(email)).map((email) => ({ email }));
  return [...kept, ...added];
}

export type MeetingTimes = { title: string; startsAt: Date; durationMinutes: number };

/** What the sync writes on the invite, apart from its guests. */
export type EventFields = {
  summary: string;
  start: { dateTime: string };
  end: { dateTime: string };
  location: string;
  description: string;
};

export function endOf(meeting: Pick<MeetingTimes, "startsAt" | "durationMinutes">): Date {
  return new Date(meeting.startsAt.getTime() + meeting.durationMinutes * 60_000);
}

export function eventFields(meeting: MeetingTimes, zoomJoinUrl: string | null): EventFields {
  return {
    summary: meeting.title,
    start: { dateTime: meeting.startsAt.toISOString() },
    end: { dateTime: endOf(meeting).toISOString() },
    location: zoomJoinUrl ?? "",
    description: zoomJoinUrl ? `Join the Zoom meeting: ${zoomJoinUrl}` : "",
  };
}

/** An invite as Google Calendar returns it; only what `eventDiffers` compares. */
export type CalendarEvent = {
  id: string;
  status?: string;
  summary?: string;
  location?: string;
  description?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: CalendarAttendee[];
};

const sameInstant = (a: string | undefined, b: string) => a !== undefined && Date.parse(a) === Date.parse(b);

const guestSet = (attendees: readonly CalendarAttendee[]) =>
  [...new Set(attendees.map((a) => normal(a.email)))].sort().join("\n");

/**
 * Whether the invite differs from what the sync would send. Updating an invite
 * emails every guest, so an unchanged one is left alone.
 */
export function eventDiffers(current: CalendarEvent, fields: EventFields, attendees: readonly CalendarAttendee[]): boolean {
  return (
    (current.summary ?? "") !== fields.summary ||
    !sameInstant(current.start?.dateTime, fields.start.dateTime) ||
    !sameInstant(current.end?.dateTime, fields.end.dateTime) ||
    (current.location ?? "") !== fields.location ||
    (current.description ?? "") !== fields.description ||
    guestSet(current.attendees ?? []) !== guestSet(attendees)
  );
}

/** What the sync sets on the Zoom meeting. */
export type ZoomFields = {
  topic: string;
  /** UTC, to the second, as Zoom writes it back: `2026-10-08T15:00:00Z`. */
  startTime: string;
  duration: number;
  /** Semicolon-separated, sorted, as Zoom takes them. */
  alternativeHosts: string;
};

export function zoomFields(meeting: MeetingTimes, alternativeHosts: readonly string[]): ZoomFields {
  return {
    topic: meeting.title,
    startTime: meeting.startsAt.toISOString().replace(/\.\d{3}Z$/, "Z"),
    duration: meeting.durationMinutes,
    alternativeHosts: [...new Set(alternativeHosts.map(normal))].sort().join(";"),
  };
}

/** A Zoom meeting as Zoom returns it; only what `zoomDiffers` compares. */
export type ZoomMeetingState = {
  topic?: string;
  start_time?: string;
  duration?: number;
  settings?: { alternative_hosts?: string };
};

export function zoomDiffers(current: ZoomMeetingState, fields: ZoomFields): boolean {
  const hosts = (current.settings?.alternative_hosts ?? "")
    .split(/[;,]/)
    .map(normal)
    .filter(Boolean)
    .sort()
    .join(";");
  return (
    (current.topic ?? "") !== fields.topic ||
    !sameInstant(current.start_time, fields.startTime) ||
    current.duration !== fields.duration ||
    hosts !== fields.alternativeHosts
  );
}

export const MEETING_STATUSES = ["not_synced", "synced", "changed", "failed"] as const;
export type MeetingStatus = (typeof MEETING_STATUSES)[number];

/**
 * Where a meeting stands with Google. `changed` is a meeting edited since its
 * invite was last brought in line; the next sync updates it. A change in who is
 * on the Current tab does not show here: every sync rechecks the guests.
 */
export function meetingStatus(m: {
  googleEventId: string | null;
  syncError: string | null;
  changedAt: Date;
  syncedAt: Date | null;
}): MeetingStatus {
  if (m.syncError) return "failed";
  if (!m.googleEventId || !m.syncedAt) return "not_synced";
  return m.changedAt > m.syncedAt ? "changed" : "synced";
}
