/** Google Meetings: whom each picked calendar meeting invites to which occurrence, who Zoom saw join, and the Current tab's marks. */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  administratorsFor,
  audienceLabel,
  audienceOf,
  cleanMeetingName,
  hasTimezoneRange,
  inTimezoneRange,
  offsetHour,
  timezoneRangeLabel,
  joinedFrom,
  meetingKey,
  meetingMark,
  mergeAttendees,
  addDays,
  planMeeting,
  sameGuests,
  zoomMeetingIdIn,
  type Member,
  type PlanInvite,
  type PlanOccurrence,
} from "../../src/lib/evals/meeting-plan";

const COHORT: Member[] = [
  { email: "Ana.Sales@harness.io", stage: "bootcamp", track: "sales" },
  { email: "ben.eng@harness.io", stage: "bootcamp", track: "engineer" },
  { email: "cy.sales@harness.io", stage: "intermediate", track: "sales" },
  { email: "di.eng@harness.io", stage: "intermediate", track: "engineer" },
];

test("a meeting is for its stage and track, either of which may be both", () => {
  assert.deepEqual(audienceOf({ stage: "bootcamp", track: "sales" }, COHORT), ["ana.sales@harness.io"]);
  assert.deepEqual(audienceOf({ stage: "both", track: "engineer" }, COHORT), ["ben.eng@harness.io", "di.eng@harness.io"]);
  assert.deepEqual(audienceOf({ stage: "intermediate", track: "both" }, COHORT), ["cy.sales@harness.io", "di.eng@harness.io"]);
  assert.equal(audienceOf({ stage: "both", track: "both" }, COHORT).length, 4);
});

test("audiences read as a person would say them", () => {
  assert.equal(audienceLabel("bootcamp", "sales"), "Bootcamp Sales");
  assert.equal(audienceLabel("both", "engineer"), "Engineers, both stages");
  assert.equal(audienceLabel("intermediate", "both"), "Intermediate, both tracks");
  assert.equal(audienceLabel("both", "both"), "Everyone");
});

test("names match whatever their case or spacing", () => {
  assert.equal(meetingKey("  Pitch   Practice "), meetingKey("pitch practice"));
  assert.equal(cleanMeetingName("  Pitch   Practice "), "Pitch Practice");
});

test("the guest list keeps who is there, adds who is missing, and drops only those the sync added", () => {
  const current = [
    { email: "kept@harness.io", responseStatus: "accepted" },
    { email: "dropped@harness.io", responseStatus: "needsAction" },
    { email: "by.hand@harness.io", responseStatus: "tentative" },
  ];
  const merged = mergeAttendees(current, ["kept@harness.io", "new@harness.io"], ["kept@harness.io", "dropped@harness.io"]);
  assert.deepEqual(merged, [
    { email: "kept@harness.io", responseStatus: "accepted" },
    { email: "by.hand@harness.io", responseStatus: "tentative" },
    { email: "new@harness.io" },
  ]);
});

test("a guest's reply survives a sync, whatever case Google spells their email in", () => {
  const merged = mergeAttendees([{ email: "Kept@Harness.io", responseStatus: "accepted" }], ["kept@harness.io"], ["kept@harness.io"]);
  assert.deepEqual(merged, [{ email: "Kept@Harness.io", responseStatus: "accepted" }]);
});

test("an invite holding the same people is left alone, since changing it emails every guest", () => {
  assert.equal(sameGuests([{ email: "B@harness.io" }, { email: "a@harness.io" }], [{ email: "a@harness.io" }, { email: "b@harness.io" }]), true);
  assert.equal(sameGuests([{ email: "a@harness.io" }], [{ email: "a@harness.io" }, { email: "b@harness.io" }]), false);
});

/* ------------------------------------------------------------------ */
/* planMeeting                                                         */
/* ------------------------------------------------------------------ */

const NOW = new Date("2026-10-20T12:00:00Z");
const CUTOFF = "2026-11-02";
const occ = (id: string, iso: string, attendanceRead = false): PlanOccurrence => ({ id, startsAt: new Date(iso), startDate: iso.slice(0, 10), attendanceRead });
const PAST = occ("past", "2026-10-13T16:00:00Z", true);
const NEXT = occ("next", "2026-10-22T16:00:00Z");
const LATER = occ("later", "2026-10-29T16:00:00Z");
const AFTER_BOOTCAMP = occ("after", "2026-11-05T16:00:00Z");
const ALL = [PAST, NEXT, LATER, AFTER_BOOTCAMP];
const invite = (occurrenceId: string, email: string, attendance: PlanInvite["attendance"] = null): PlanInvite => ({
  occurrenceId,
  email,
  role: "member",
  addedBySync: true,
  attendance,
});
const plan = (audience: string[], invites: PlanInvite[], marks: [string, boolean][] = [], occurrences = ALL) =>
  planMeeting({ audience, occurrences, invites, marks: new Map(marks), now: NOW, cutoff: CUTOFF });

test("someone not yet invited is invited to the next occurrence still to start", () => {
  const { outcomes, remove } = plan(["a@harness.io"], []);
  assert.deepEqual(outcomes.get("a@harness.io"), { kind: "invite", occurrenceId: "next", afterMiss: false });
  assert.deepEqual(remove, []);
});

const withStart = (days: number, startDate: string | null, occurrences = ALL) =>
  planMeeting({
    audience: ["a@harness.io"],
    occurrences,
    invites: [],
    marks: new Map(),
    now: NOW,
    cutoff: CUTOFF,
    minDaysAfterStart: days,
    startDates: new Map([["a@harness.io", startDate]]),
  }).outcomes.get("a@harness.io");

test("addDays moves a date across month ends", () => {
  assert.equal(addDays("2026-10-28", 5), "2026-11-02");
  assert.equal(addDays("2026-10-28", 0), "2026-10-28");
});

test("a start date plus the days holds back an occurrence that comes too soon", () => {
  assert.deepEqual(withStart(0, "2026-10-21"), { kind: "invite", occurrenceId: "next", afterMiss: false });
  assert.deepEqual(withStart(3, "2026-10-21"), { kind: "invite", occurrenceId: "later", afterMiss: false });
  // On the day it falls exactly: 22 + 7 = 29.
  assert.deepEqual(withStart(7, "2026-10-22"), { kind: "invite", occurrenceId: "later", afterMiss: false });
});

test("with none late enough before the bootcamp, the last one there is", () => {
  assert.deepEqual(withStart(30, "2026-10-21"), { kind: "invite", occurrenceId: "later", afterMiss: false });
});

test("someone with no start date is offered the first occurrence", () => {
  assert.deepEqual(withStart(30, null), { kind: "invite", occurrenceId: "next", afterMiss: false });
});

test("someone already invited stays where they are whatever the days", () => {
  const { outcomes } = planMeeting({
    audience: ["a@harness.io"],
    occurrences: ALL,
    invites: [invite("next", "a@harness.io")],
    marks: new Map(),
    now: NOW,
    cutoff: CUTOFF,
    minDaysAfterStart: 5,
    startDates: new Map([["a@harness.io", "2026-10-21"]]),
  });
  assert.deepEqual(outcomes.get("a@harness.io"), { kind: "invited", occurrenceId: "next" });
});

test("someone already invited to an occurrence still to come stays on it", () => {
  const { outcomes } = plan(["a@harness.io"], [invite("later", "a@harness.io")]);
  assert.deepEqual(outcomes.get("a@harness.io"), { kind: "invited", occurrenceId: "later" });
});

test("someone who missed theirs is invited to the next one after it", () => {
  const { outcomes } = plan(["a@harness.io"], [invite("past", "a@harness.io", "missed")]);
  assert.deepEqual(outcomes.get("a@harness.io"), { kind: "invite", occurrenceId: "next", afterMiss: true });
});

test("someone who attended is done, and taken off any later occurrence", () => {
  const { outcomes, remove } = plan(["a@harness.io"], [invite("past", "a@harness.io", "attended"), invite("later", "a@harness.io")]);
  assert.deepEqual(outcomes.get("a@harness.io"), { kind: "attended" });
  assert.deepEqual(
    remove.map((r) => r.occurrenceId),
    ["later"],
  );
});

test("an occurrence on or after the bootcamp's first day is never offered", () => {
  const { outcomes } = plan(["a@harness.io"], [invite("past", "a@harness.io", "missed")], [], [PAST, AFTER_BOOTCAMP]);
  assert.deepEqual(outcomes.get("a@harness.io"), { kind: "none_left" });
});

test("an occurrence that is over waits on Zoom before anyone is moved on", () => {
  const begun = occ("begun", "2026-10-20T11:00:00Z");
  const { outcomes } = plan(["a@harness.io"], [invite("begun", "a@harness.io")], [], [begun, NEXT]);
  assert.deepEqual(outcomes.get("a@harness.io"), { kind: "waiting", occurrenceId: "begun" });
});

test("an administrator's mark overrides Zoom either way", () => {
  const attended = plan(["a@harness.io"], [invite("past", "a@harness.io", "missed")], [["a@harness.io", true]]);
  assert.deepEqual(attended.outcomes.get("a@harness.io"), { kind: "attended" });

  const begun = occ("begun", "2026-10-20T11:00:00Z");
  const missed = plan(["a@harness.io"], [invite("begun", "a@harness.io")], [["a@harness.io", false]], [begun, NEXT]);
  assert.deepEqual(missed.outcomes.get("a@harness.io"), { kind: "invite", occurrenceId: "next", afterMiss: true });

  const overZoom = plan(["a@harness.io"], [invite("past", "a@harness.io", "attended")], [["a@harness.io", false]]);
  assert.deepEqual(overZoom.outcomes.get("a@harness.io"), { kind: "invite", occurrenceId: "next", afterMiss: true });
});

test("someone the meeting is no longer for is taken off what is still to come, not what has happened", () => {
  const { outcomes, remove } = plan([], [invite("past", "gone@harness.io"), invite("next", "gone@harness.io")]);
  assert.equal(outcomes.size, 0);
  assert.deepEqual(
    remove.map((r) => r.occurrenceId),
    ["next"],
  );
});

test("an administrator's invite is not a member's", () => {
  const { outcomes } = plan(["a@harness.io"], [{ ...invite("later", "a@harness.io"), role: "administrator" }]);
  assert.deepEqual(outcomes.get("a@harness.io"), { kind: "invite", occurrenceId: "next", afterMiss: false });
});

test("emails are compared lowercased", () => {
  const { outcomes } = plan(["A@Harness.io"], [invite("later", "a@harness.io")]);
  assert.deepEqual(outcomes.get("a@harness.io"), { kind: "invited", occurrenceId: "later" });
});

/* ------------------------------------------------------------------ */
/* Administrators, Zoom and the Current tab                            */
/* ------------------------------------------------------------------ */

test("administrators go on each occurrence a member is on, and none other", () => {
  const admins = administratorsFor(
    ["next", "later"],
    new Map([["next", new Set(["a@harness.io", "admin.two@harness.io"])]]),
    ["Admin.One@harness.io", "admin.two@harness.io", "admin.one@harness.io"],
  );
  assert.deepEqual(admins.get("next"), ["admin.one@harness.io"]);
  assert.deepEqual(admins.get("later"), []);
});

test("the Zoom meeting is read from the first join link found", () => {
  assert.equal(zoomMeetingIdIn(null, "Join: https://harness-io.zoom.us/j/91234567890?pwd=abc"), "91234567890");
  assert.equal(zoomMeetingIdIn("https://zoom.us/my/123456789", "https://zoom.us/j/99999999999"), "123456789");
  assert.equal(zoomMeetingIdIn("https://meet.google.com/abc-defg-hij", undefined), null);
});

test("Zoom's participants match by email, else by full name", () => {
  const joined = joinedFrom(
    [{ name: "Someone Else", user_email: "A@harness.io" }, { name: "  ben   ENG " }, { name: "" }],
    [
      { email: "a@harness.io", fullName: "Ana Sales" },
      { email: "ben@harness.io", fullName: "Ben Eng" },
      { email: "cy@harness.io", fullName: "" },
      { email: "di@harness.io", fullName: "Di Eng" },
    ],
  );
  assert.deepEqual([...joined].sort(), ["a@harness.io", "ben@harness.io"]);
});

test("the Current tab's mark", () => {
  assert.equal(meetingMark({ attended: true, response: null, invited: false, anyLeft: false }), "attended");
  assert.equal(meetingMark({ attended: false, response: "accepted", invited: true, anyLeft: true }), "accepted");
  assert.equal(meetingMark({ attended: false, response: "needsAction", invited: true, anyLeft: false }), "pending");
  assert.equal(meetingMark({ attended: false, response: null, invited: false, anyLeft: true }), "uninvited");
  assert.equal(meetingMark({ attended: false, response: null, invited: false, anyLeft: false }), "none_left");
});

const JULY = new Date("2026-07-15T12:00:00Z");
const JANUARY = new Date("2026-01-15T12:00:00Z");

test("a time zone is a whole-hour UTC offset, half hours rounding east", () => {
  assert.equal(offsetHour("America/Chicago", JULY), -5);
  assert.equal(offsetHour("America/Chicago", JANUARY), -6);
  assert.equal(offsetHour("Asia/Kolkata", JULY), 6);
  assert.equal(offsetHour("America/St_Johns", JULY), -2);
  assert.equal(offsetHour("UTC", JULY), 0);
});

test("a time zone range leaves out anyone outside it, or with no zone", () => {
  const range = { timezoneFrom: -8, timezoneTo: -5 };
  assert.ok(hasTimezoneRange(range));
  assert.equal(inTimezoneRange("America/Los_Angeles", range, JULY), true);
  assert.equal(inTimezoneRange("America/Chicago", range, JULY), true);
  assert.equal(inTimezoneRange("America/New_York", range, JULY), false);
  assert.equal(inTimezoneRange("Europe/London", range, JULY), false);
  assert.equal(inTimezoneRange(null, range, JULY), false);
  assert.equal(inTimezoneRange("not a zone", range, JULY), false);
  // No range: everyone, zone or not.
  // A first after the second runs east through the date line: +9 to -6.
  const wrapped = { timezoneFrom: 9, timezoneTo: -6 };
  assert.equal(inTimezoneRange("Asia/Tokyo", wrapped, JULY), true);
  assert.equal(inTimezoneRange("Pacific/Auckland", wrapped, JULY), true);
  assert.equal(inTimezoneRange("America/Denver", wrapped, JULY), true);
  assert.equal(inTimezoneRange("America/Chicago", wrapped, JULY), false);
  assert.equal(inTimezoneRange("America/New_York", wrapped, JULY), false);
  assert.equal(inTimezoneRange("Europe/London", wrapped, JULY), false);
  assert.equal(inTimezoneRange(null, { timezoneFrom: null, timezoneTo: null }, JULY), true);
  assert.equal(hasTimezoneRange({}), false);
});

test("the time zone range narrows a meeting's audience", () => {
  const cohort: Member[] = [
    { email: "a@harness.io", stage: "bootcamp", track: "sales", timezone: "America/Los_Angeles" },
    { email: "b@harness.io", stage: "bootcamp", track: "sales", timezone: "Europe/London" },
    { email: "c@harness.io", stage: "bootcamp", track: "sales", timezone: null },
    { email: "d@harness.io", stage: "bootcamp", track: "engineer", timezone: "America/Los_Angeles" },
  ];
  const meeting = { stage: "bootcamp", track: "sales", timezoneFrom: -8, timezoneTo: -7 } as const;
  assert.deepEqual(audienceOf(meeting, cohort, JULY), ["a@harness.io"]);
  assert.deepEqual(audienceOf({ ...meeting, timezoneFrom: null, timezoneTo: null }, cohort, JULY), ["a@harness.io", "b@harness.io", "c@harness.io"]);
});

test("a time zone range reads as a person would say it", () => {
  assert.equal(timezoneRangeLabel(-8, -5), "UTC-8 to UTC-5");
  assert.equal(timezoneRangeLabel(1, 1), "UTC+1");
  assert.equal(timezoneRangeLabel(9, -6), "UTC+9 to UTC-6");
  assert.equal(timezoneRangeLabel(0, 3), "UTC+0 to UTC+3");
});
