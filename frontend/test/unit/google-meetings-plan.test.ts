/** Google Meetings: whom each meeting invites, how that merges with the invite as it stands, and when an invite or Zoom meeting needs changing. */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  eventDiffers,
  eventFields,
  inviteList,
  meetingStatus,
  mergeAttendees,
  orderedGroups,
  zoomDiffers,
  zoomFields,
  type CohortMember,
} from "../../src/lib/evals/google-meetings-plan";

const COHORT: CohortMember[] = [
  { email: "Ana.Sales@harness.io", stage: "bootcamp", track: "sales" },
  { email: "ben.eng@harness.io", stage: "bootcamp", track: "engineer" },
  { email: "cy.sales@harness.io", stage: "intermediate", track: "sales" },
  { email: "di.eng@harness.io", stage: "intermediate", track: "engineer" },
];

const ADMINS = ["admin.one@harness.io", "admin.two@harness.io"];
const ORGANIZER = "evals@harness.io";

test("Bootcamp Sales invites the bootcamp stage on the Sales track, and every administrator", () => {
  assert.deepEqual(inviteList(["bootcamp_sales"], COHORT, ADMINS, ORGANIZER), [
    "admin.one@harness.io",
    "admin.two@harness.io",
    "ana.sales@harness.io",
  ]);
});

test("Bootcamp Engineers takes neither Sales nor the intermediate stage", () => {
  assert.deepEqual(inviteList(["bootcamp_engineer"], COHORT, [], ORGANIZER), ["ben.eng@harness.io"]);
});

test("each group adds its own people, and someone in two places is invited once", () => {
  const both = inviteList(["bootcamp_sales", "intermediate_engineer"], COHORT, ["ANA.SALES@harness.io"], ORGANIZER);
  assert.deepEqual(both, ["ana.sales@harness.io", "di.eng@harness.io"]);
});

test("no groups invites the administrators alone, and the organizer is never a guest", () => {
  assert.deepEqual(inviteList([], COHORT, [...ADMINS, ORGANIZER], ORGANIZER), ADMINS);
});

test("the guest list keeps who is there, adds who is missing, and drops only those the last sync added", () => {
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

const MEETING = { title: "Kickoff", startsAt: new Date("2026-10-08T15:00:00.000Z"), durationMinutes: 30 };

test("the invite runs from the start for its length, with the Zoom link where guests look for it", () => {
  const fields = eventFields(MEETING, "https://zoom.us/j/123");
  assert.deepEqual(fields, {
    summary: "Kickoff",
    start: { dateTime: "2026-10-08T15:00:00.000Z" },
    end: { dateTime: "2026-10-08T15:30:00.000Z" },
    location: "https://zoom.us/j/123",
    description: "Join the Zoom meeting: https://zoom.us/j/123",
  });
  assert.deepEqual(eventFields(MEETING, null).location, "");
});

test("an invite matching what would be sent is left alone, even as Google writes it back", () => {
  const fields = eventFields(MEETING, "https://zoom.us/j/123");
  const asGoogleHasIt = {
    id: "e1",
    summary: "Kickoff",
    // Google answers in the calendar's own zone.
    start: { dateTime: "2026-10-08T08:00:00-07:00" },
    end: { dateTime: "2026-10-08T08:30:00-07:00" },
    location: "https://zoom.us/j/123",
    description: "Join the Zoom meeting: https://zoom.us/j/123",
    attendees: [{ email: "B@harness.io" }, { email: "a@harness.io" }],
  };
  assert.equal(eventDiffers(asGoogleHasIt, fields, [{ email: "a@harness.io" }, { email: "b@harness.io" }]), false);
});

test("a new time, title, link or guest changes the invite", () => {
  const fields = eventFields(MEETING, null);
  const base = { id: "e1", summary: "Kickoff", start: fields.start, end: fields.end, location: "", description: "", attendees: [] };
  assert.equal(eventDiffers(base, fields, []), false);
  assert.equal(eventDiffers({ ...base, summary: "Old title" }, fields, []), true);
  assert.equal(eventDiffers({ ...base, end: { dateTime: "2026-10-08T16:00:00.000Z" } }, fields, []), true);
  assert.equal(eventDiffers(base, eventFields(MEETING, "https://zoom.us/j/9"), []), true);
  assert.equal(eventDiffers(base, fields, [{ email: "new@harness.io" }]), true);
});

test("Zoom gets the start in UTC to the second, and the alternative hosts sorted, once each", () => {
  assert.deepEqual(zoomFields(MEETING, ["b@harness.io", "A@harness.io", "a@harness.io"]), {
    topic: "Kickoff",
    startTime: "2026-10-08T15:00:00Z",
    duration: 30,
    alternativeHosts: "a@harness.io;b@harness.io",
  });
});

test("a Zoom meeting as Zoom returns it is unchanged when only the spelling of its hosts differs", () => {
  const fields = zoomFields(MEETING, ["a@harness.io", "b@harness.io"]);
  const current = { topic: "Kickoff", start_time: "2026-10-08T15:00:00Z", duration: 30, settings: { alternative_hosts: "B@harness.io,a@harness.io" } };
  assert.equal(zoomDiffers(current, fields), false);
  assert.equal(zoomDiffers({ ...current, duration: 60 }, fields), true);
  assert.equal(zoomDiffers({ ...current, settings: { alternative_hosts: "a@harness.io" } }, fields), true);
});

test("a meeting is not synced until it has an invite, then changed once edited since", () => {
  const at = new Date("2026-10-01T00:00:00Z");
  const later = new Date("2026-10-02T00:00:00Z");
  assert.equal(meetingStatus({ googleEventId: null, syncError: null, changedAt: at, syncedAt: null }), "not_synced");
  assert.equal(meetingStatus({ googleEventId: "e1", syncError: null, changedAt: at, syncedAt: later }), "synced");
  assert.equal(meetingStatus({ googleEventId: "e1", syncError: null, changedAt: later, syncedAt: at }), "changed");
  assert.equal(meetingStatus({ googleEventId: "e1", syncError: "boom", changedAt: at, syncedAt: later }), "failed");
});

test("groups are kept in the form's order, each once", () => {
  assert.deepEqual(orderedGroups(["intermediate_engineer", "bootcamp_sales", "bootcamp_sales"]), ["bootcamp_sales", "intermediate_engineer"]);
});
