/**
 * Whom a Google Meetings sync invites to which occurrence of each picked
 * calendar meeting, worked out without touching Google, Zoom or the database.
 * Pure, so the unit suite covers the rules; `meeting-sync.ts` does the
 * reading and the calling.
 *
 * A picked meeting is for one stage and one track of the Cohorts page's
 * Current tab, or both of either. Each person it is for is invited to one
 * occurrence of it: the next one before their bootcamp starts. Once that
 * occurrence is over, Zoom says whether they joined. Someone who did is done;
 * someone who did not is invited to the next occurrence after it, while one
 * is left before the bootcamp. An administrator's mark overrides Zoom either
 * way. Every Assessments Administrator is invited to each upcoming
 * occurrence a cohort member is on.
 *
 * A meeting may also hold back from people who started recently: it offers
 * each the first occurrence on or after their start date plus a number of
 * days, or, when none is left before the bootcamp, the last one there is.
 *
 * A meeting may also cover a range of UTC offsets, in whole hours; then only
 * people whose time zone falls inside it are among those it is for.
 */

import type { MeetingAttendance, MeetingInviteRole, MeetingStage, MeetingTrack } from "@/db/schema";
import { utcOffsetMinutes } from "@/lib/timezones";

export const MEETING_STAGE_LABELS: Record<MeetingStage, string> = {
  bootcamp: "Bootcamp",
  intermediate: "Intermediate",
  both: "Both",
};

export const MEETING_TRACK_LABELS: Record<MeetingTrack, string> = {
  sales: "Sales",
  engineer: "Engineers",
  both: "Both",
};

/** "Bootcamp Sales", "Intermediate, both tracks", "Everyone". */
export function audienceLabel(stage: MeetingStage, track: MeetingTrack): string {
  if (stage === "both" && track === "both") return "Everyone";
  if (stage === "both") return `${MEETING_TRACK_LABELS[track]}, both stages`;
  if (track === "both") return `${MEETING_STAGE_LABELS[stage]}, both tracks`;
  return `${MEETING_STAGE_LABELS[stage]} ${MEETING_TRACK_LABELS[track]}`;
}

/** Names compare as the calendar shows them, ignoring stray spaces and case. */
export function meetingKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

export function cleanMeetingName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

export type Member = {
  email: string;
  stage: "bootcamp" | "intermediate";
  track: "sales" | "engineer";
  /** An IANA zone such as `America/Chicago`; null or missing when the app has none for them. */
  timezone?: string | null;
  /** The day they started, `YYYY-MM-DD`; null or missing when the record has none. */
  startDate?: string | null;
};

/** `date` (`YYYY-MM-DD`) plus `days`, in the same form. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The UTC offsets, in whole hours, a meeting covers; both null or missing for no filter. */
export type TimezoneRange = { timezoneFrom?: number | null; timezoneTo?: number | null };

export const TIMEZONE_HOURS = { min: -12, max: 14 } as const;

/** `zone`'s UTC offset at `at` as a whole hour, half hours rounding toward the east: India is +6, Newfoundland -3. */
export function offsetHour(zone: string, at: Date): number {
  return Math.round(utcOffsetMinutes(zone, at) / 60);
}

/** Whether `range` filters at all. */
export function hasTimezoneRange(range: TimezoneRange): range is { timezoneFrom: number; timezoneTo: number } {
  return typeof range.timezoneFrom === "number" && typeof range.timezoneTo === "number";
}

/** Whether offset `hour` is in `from`..`to`; a `from` after `to` runs east through the date line, so +9 to -6 holds +9..+14 and -12..-6. */
export function offsetInRange(hour: number, from: number, to: number): boolean {
  return from <= to ? hour >= from && hour <= to : hour >= from || hour <= to;
}

/** `UTC-8 to UTC-5`, or `UTC+1` for a single hour. */
export function timezoneRangeLabel(from: number, to: number): string {
  const one = (h: number) => `UTC${h < 0 ? "-" : "+"}${Math.abs(h)}`;
  return from === to ? one(from) : `${one(from)} to ${one(to)}`;
}

/** Whether someone in `zone` is inside `range`; anyone with no known zone is outside a range, and inside none. */
export function inTimezoneRange(zone: string | null | undefined, range: TimezoneRange, at: Date): boolean {
  if (!hasTimezoneRange(range)) return true;
  if (!zone) return false;
  try {
    const hour = offsetHour(zone, at);
    return offsetInRange(hour, range.timezoneFrom, range.timezoneTo);
  } catch {
    return false;
  }
}

const normal = (email: string) => email.trim().toLowerCase();

/** A guest as Google Calendar lists one; everything it returns is sent back untouched. */
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

/** An event as the events list returns it, with only what the sync reads. */
export type CalendarEvent = {
  id: string;
  status?: string;
  summary?: string;
  location?: string;
  description?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  attendees?: CalendarAttendee[];
  conferenceData?: { entryPoints?: { uri?: string }[] };
};

/**
 * The guest list to send. Someone already on the invite keeps their entry, and
 * with it their reply; someone wanted and missing is added; someone the sync
 * added and no longer wanted is taken off. Anyone else on the invite was put
 * there by hand, or by whoever owns the meeting, and stays.
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

/** Whether a picked meeting is for someone in this stage and on this track, and in its time zones when it has any. */
export function meetingIsFor(
  meeting: { stage: MeetingStage; track: MeetingTrack } & TimezoneRange,
  member: Pick<Member, "stage" | "track" | "timezone">,
  at: Date = new Date(),
): boolean {
  return (
    (meeting.stage === "both" || meeting.stage === member.stage) &&
    (meeting.track === "both" || meeting.track === member.track) &&
    inTimezoneRange(member.timezone, meeting, at)
  );
}

/** The people a picked meeting is for, lowercased, each once, sorted. */
export function audienceOf(
  meeting: { stage: MeetingStage; track: MeetingTrack } & TimezoneRange,
  cohort: readonly Member[],
  at: Date = new Date(),
): string[] {
  return [...new Set(cohort.filter((m) => meetingIsFor(meeting, m, at)).map((m) => normal(m.email)))].filter(Boolean).sort();
}

export type PlanOccurrence = {
  id: string;
  startsAt: Date;
  /** The day it starts in the calendar's time zone, `YYYY-MM-DD`. */
  startDate: string;
  /** Whether Zoom's word on who joined it has been read. */
  attendanceRead: boolean;
};

export type PlanInvite = {
  occurrenceId: string;
  email: string;
  role: MeetingInviteRole;
  addedBySync: boolean;
  attendance: MeetingAttendance | null;
};

/** For the run log and the Current tab: where one person stands with one meeting. */
export type MemberOutcome =
  /** Zoom saw them join, or an administrator marked them attended. */
  | { kind: "attended" }
  /** Invited to an occurrence still to come, or not yet over. */
  | { kind: "invited"; occurrenceId: string }
  /** Invited now: to their first occurrence, or the next one after a miss. */
  | { kind: "invite"; occurrenceId: string; afterMiss: boolean }
  /** Their occurrence is over and who joined it is not known yet. */
  | { kind: "waiting"; occurrenceId: string }
  /** No occurrence is left before their bootcamp. */
  | { kind: "none_left" };

export type MeetingPlan = {
  outcomes: Map<string, MemberOutcome>;
  /** Member invites to take away: their person is no longer one the meeting is for, or has already attended. */
  remove: PlanInvite[];
};

/**
 * One meeting's plan for one sync. `invites` are this mode's only (the test
 * group's, or the cohort's), and only `role: "member"` ones are read here;
 * `marks` are administrators' word, email to attended. An occurrence is
 * offered only if it starts after `now` and on a day before `cutoff`, the
 * bootcamp's start date. A person not yet invited gets the first of those on
 * or after their start date plus `minDaysAfterStart`, else the last of them.
 */
export function planMeeting(input: {
  audience: readonly string[];
  occurrences: readonly PlanOccurrence[];
  invites: readonly PlanInvite[];
  marks: ReadonlyMap<string, boolean>;
  now: Date;
  cutoff: string;
  /** Days after a person's start date before an occurrence suits them; 0 asks nothing more than the start date itself. */
  minDaysAfterStart?: number;
  /** Each person's start date, lowercased email to `YYYY-MM-DD`; someone with none is offered the first occurrence there is. */
  startDates?: ReadonlyMap<string, string | null>;
}): MeetingPlan {
  const byId = new Map(input.occurrences.map((o) => [o.id, o]));
  const upcoming = [...input.occurrences]
    .filter((o) => o.startsAt > input.now && o.startDate < input.cutoff)
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const memberInvites = input.invites.filter((i) => i.role === "member" && byId.has(i.occurrenceId));
  const invitesOf = new Map<string, PlanInvite[]>();
  for (const invite of memberInvites) {
    const email = normal(invite.email);
    invitesOf.set(email, [...(invitesOf.get(email) ?? []), invite]);
  }

  const outcomes = new Map<string, MemberOutcome>();
  const remove: PlanInvite[] = [];
  const audience = new Set(input.audience.map(normal));

  for (const email of [...audience].sort()) {
    const mine = (invitesOf.get(email) ?? []).map((i) => ({ invite: i, at: byId.get(i.occurrenceId)! }));
    const mark = input.marks.get(email);
    const open = mine.filter(({ invite, at }) => invite.attendance === null && !at.attendanceRead);
    const future = open.filter(({ at }) => at.startsAt > input.now);

    if (mark === true || (mark === undefined && mine.some(({ invite }) => invite.attendance === "attended"))) {
      outcomes.set(email, { kind: "attended" });
      remove.push(...future.map(({ invite }) => invite));
      continue;
    }
    if (future.length > 0) {
      const next = future.sort((a, b) => a.at.startsAt.getTime() - b.at.startsAt.getTime())[0]!;
      outcomes.set(email, { kind: "invited", occurrenceId: next.invite.occurrenceId });
      continue;
    }
    // An administrator's "missed" stands for every occurrence that has begun, whatever Zoom said or has yet to say.
    const begun = mine.filter(({ at }) => at.startsAt <= input.now);
    const pending = mark === false ? [] : begun.filter(({ invite, at }) => invite.attendance === null && !at.attendanceRead);
    if (pending.length > 0) {
      outcomes.set(email, { kind: "waiting", occurrenceId: pending[0]!.invite.occurrenceId });
      continue;
    }
    const lastBegun = Math.max(-Infinity, ...begun.map(({ at }) => at.startsAt.getTime()));
    const after = upcoming.filter((o) => o.startsAt.getTime() > lastBegun);
    const started = input.startDates?.get(email);
    const earliest = started ? addDays(started, input.minDaysAfterStart ?? 0) : null;
    // Nothing late enough before the bootcamp: the last occurrence there is.
    const next = after.find((o) => earliest === null || o.startDate >= earliest) ?? after.at(-1);
    outcomes.set(email, next ? { kind: "invite", occurrenceId: next.id, afterMiss: begun.length > 0 } : { kind: "none_left" });
  }

  for (const [email, invites] of invitesOf) {
    if (audience.has(email)) continue;
    remove.push(...invites.filter((i) => i.attendance === null && byId.get(i.occurrenceId)!.startsAt > input.now));
  }
  return { outcomes, remove };
}

/**
 * The administrators each upcoming occurrence should have: all of them on one
 * a cohort member is on after the plan, none on one no member is. The
 * organizer and the members themselves are left out.
 */
export function administratorsFor(
  occurrenceIds: readonly string[],
  memberEmailsOn: ReadonlyMap<string, ReadonlySet<string>>,
  administrators: readonly string[],
): Map<string, string[]> {
  const admins = [...new Set(administrators.map(normal))].filter(Boolean).sort();
  return new Map(
    occurrenceIds.map((id) => {
      const members = memberEmailsOn.get(id) ?? new Set<string>();
      return [id, members.size > 0 ? admins.filter((a) => !members.has(a)) : []];
    }),
  );
}

/** The meeting id in a Zoom join link, such as `https://harness-io.zoom.us/j/91234567890?pwd=…`. */
export function zoomMeetingIdIn(...texts: (string | null | undefined)[]): string | null {
  for (const text of texts) {
    const match = /zoom\.us\/(?:j|my|w)\/(\d{9,12})\b/.exec(text ?? "");
    if (match) return match[1]!;
  }
  return null;
}

/** A participant as Zoom's past-meeting participants report lists one. */
export type ZoomParticipant = { name?: string; user_email?: string };

/**
 * Of `invited`, who Zoom saw join: by email where Zoom has one, else by a
 * name that matches someone's full name. Names are compared lowercased with
 * their spaces collapsed.
 */
export function joinedFrom(
  participants: readonly ZoomParticipant[],
  invited: readonly { email: string; fullName: string }[],
): Set<string> {
  const name = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  const emails = new Set(participants.map((p) => normal(p.user_email ?? "")).filter(Boolean));
  const names = new Set(participants.map((p) => name(p.name ?? "")).filter(Boolean));
  return new Set(
    invited
      .filter((i) => emails.has(normal(i.email)) || (i.fullName.trim() !== "" && names.has(name(i.fullName))))
      .map((i) => normal(i.email)),
  );
}

/** Whether two guest lists hold the same people; updating an invite emails every guest, so an unchanged one is left alone. */
export function sameGuests(a: readonly CalendarAttendee[], b: readonly CalendarAttendee[]): boolean {
  const set = (list: readonly CalendarAttendee[]) => [...new Set(list.map((g) => normal(g.email)))].sort().join("\n");
  return set(a) === set(b);
}

/** Where someone stands with one meeting on the Current tab. */
export const MEETING_MARKS = ["attended", "accepted", "pending", "none_left"] as const;
export type MeetingMark = (typeof MEETING_MARKS)[number];

/**
 * The icon the Current tab shows: attended; else accepted or not yet on the
 * invite they hold; else, with no occurrence left before their bootcamp,
 * `none_left`; else `pending` until the next sync invites them.
 */
export function meetingMark(input: {
  attended: boolean;
  /** Google's answer on the invite they hold that is still to happen, or not yet known to be missed. */
  response: string | null;
  invited: boolean;
  anyLeft: boolean;
}): MeetingMark {
  if (input.attended) return "attended";
  if (input.invited) return input.response === "accepted" ? "accepted" : "pending";
  return input.anyLeft ? "pending" : "none_left";
}
