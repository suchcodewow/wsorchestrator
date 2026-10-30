/**
 * Google Meetings against a real database, with the Revenue Enablement
 * calendar and Zoom played by a fake `fetch`: picking meetings, connecting an
 * account, and what Sync Now reads, invites and takes back. Nothing leaves the
 * machine.
 *
 * The sync works on the whole database: every picked meeting, the whole
 * Current tab and the active bootcamp. So the suite names its meetings with
 * `TEST_PREFIX`, asserts only on its own candidates, keeps the test group off,
 * and moves the active bootcamp's start date out of the way if it must, putting
 * it back afterwards. The connections and the live setting are one row each;
 * those already there are put back too. A live run also forgets any meeting
 * the old create-a-meeting flow left in the scratch database.
 */

import "../support/test-env";

import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { and, eq, inArray, like } from "drizzle-orm";

process.env.AUTH_SECRET ||= "google-meetings-test-secret-google-meetings";
process.env.AUTH_GOOGLE_ID = "test-client-id";
process.env.AUTH_GOOGLE_SECRET = "test-client-secret";

import { db } from "@/db";
import {
  bootcamps,
  EVALS_SETTINGS_KEYS,
  employees,
  evalsSettings,
  GOOGLE_CONNECTION_KEY,
  googleConnections,
  googleMeetings,
  intakeResponses,
  meetingInvites,
  meetingOccurrences,
  meetingSelections,
  meetingSyncRuns,
  ZOOM_CONNECTION_KEY,
  zoomConnections,
} from "@/db/schema";
import { cancelTestMeetingInvites, REVENUE_ENABLEMENT_CALENDAR_ID, runMeetingSync, takeMeetingGuestsOff, upcomingMeetingNames } from "@/lib/evals/meeting-sync";
import {
  createMeetingSelection,
  googleConnectionStatus,
  listMeetingSelections,
  listMeetingSyncChanges,
  meetingStatusesFor,
  saveGoogleConnection,
  setAttendanceMark,
  setMeetingSyncLive,
  updateMeetingSelection,
  type GoogleConnection,
} from "@/lib/evals/google-meetings";
import { saveTestGroup } from "@/lib/cohorts/test-group";
import { MEETING_SELECTION_LIST, MEETING_SYNC_CHANGE_LIST } from "@/lib/list-specs";
import { sealSecret } from "@/lib/secret-box";
import { saveZoomConnection } from "@/lib/zoom-connection";
import { PERSONAS } from "../support/access";
import { TEST_EMAIL_DOMAIN, TEST_PREFIX } from "../support/db";
import { testScope, type TestUser } from "../support/seed";

const scope = testScope("gmeet");
const DAY = 24 * 60 * 60_000;
const today = new Date().toISOString().slice(0, 10);
const ORGANIZER = `${TEST_PREFIX}organizer@${TEST_EMAIL_DOMAIN}`;
const ZOOM_USER = `${TEST_PREFIX}zoomuser@${TEST_EMAIL_DOMAIN}`;
const NAME = `${TEST_PREFIX}Pitch Practice`;
const ZOOM_ID = "91234567890";

let admin: TestUser;
let saved: GoogleConnection | null = null;
let savedZoom: typeof zoomConnections.$inferSelect | null = null;
let savedSettings: (typeof evalsSettings.$inferSelect)[] = [];
/** The active bootcamp, and its start date before the suite moved it, if it did. */
let bootcamp: { id: string; startDate: string; movedFrom: string | null };

/* ------------------------------------------------------------------ */
/* The calendar and Zoom, played by a fake fetch                       */
/* ------------------------------------------------------------------ */

type Call = { method: string; url: URL; body: Record<string, unknown> | null };
type Guest = { email: string; responseStatus?: string };
type FakeEvent = { id: string; summary: string; status?: string; start: { dateTime?: string; date?: string }; end: { dateTime?: string; date?: string }; location?: string; attendees?: Guest[] };

const fake = {
  calls: [] as Call[],
  events: new Map<string, FakeEvent>(),
  /** Past sessions of a Zoom meeting, by meeting id; their participants by session uuid. */
  instances: new Map<string, { uuid: string; start_time: string }[]>(),
  participants: new Map<string, { name?: string; user_email?: string }[]>(),
  reset() {
    this.calls = [];
    this.events.clear();
    this.instances.clear();
    this.participants.clear();
  },
  /** The calls that changed an event, as `METHOD eventId`. */
  writes() {
    return this.calls
      .filter((c) => c.url.host === "www.googleapis.com" && c.method !== "GET")
      .map((c) => `${c.method} ${decodeURIComponent(c.url.pathname.split("/").at(-1)!)}`);
  },
  guests(eventId: string) {
    return (this.events.get(eventId)?.attendees ?? []).map((a) => a.email.toLowerCase());
  },
};

const json = (body: unknown, status = 200) =>
  new Response(body === null ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const realFetch = globalThis.fetch;

async function fakeFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const method = init?.method ?? "GET";
  const body = typeof init?.body === "string" && init.body.startsWith("{") ? (JSON.parse(init.body) as Record<string, unknown>) : null;
  fake.calls.push({ method, url, body });
  const path = url.pathname;

  if (url.host === "oauth2.googleapis.com") return json({ access_token: "google-token" });
  if (url.host === "zoom.us") {
    return json({
      access_token: "zoom-access",
      refresh_token: "zoom-refresh",
      expires_in: 3600,
      scope: "meeting:read:list_past_instances meeting:read:list_past_participants meeting:delete:meeting user:read:user",
    });
  }
  if (url.host === "api.zoom.us") {
    const instances = /^\/v2\/past_meetings\/([^/]+)\/instances$/.exec(path);
    if (instances) return json({ meetings: fake.instances.get(decodeURIComponent(instances[1]!)) ?? [] });
    const participants = /^\/v2\/past_meetings\/([^/]+)\/participants$/.exec(path);
    if (participants) return json({ participants: fake.participants.get(decodeURIComponent(decodeURIComponent(participants[1]!))) ?? [] });
    if (/^\/v2\/meetings\/[^/]+$/.test(path) && method === "DELETE") return new Response(null, { status: 204 });
  }
  if (url.host === "www.googleapis.com") {
    const match = /^\/calendar\/v3\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/.exec(path);
    if (match && decodeURIComponent(match[1]!) !== REVENUE_ENABLEMENT_CALENDAR_ID) {
      // The old flow's own calendar: its invites are only ever cancelled.
      if (method === "DELETE") return new Response(null, { status: 204 });
    } else if (match && !match[2] && method === "GET") {
      const from = Date.parse(url.searchParams.get("timeMin")!);
      const to = Date.parse(url.searchParams.get("timeMax")!);
      const items = [...fake.events.values()].filter((e) => {
        const start = Date.parse(e.start.dateTime ?? e.start.date!);
        const end = Date.parse(e.end.dateTime ?? e.end.date!);
        return end > from && start < to;
      });
      return json({ timeZone: "UTC", items });
    } else if (match && match[2]) {
      const id = decodeURIComponent(match[2]);
      const current = fake.events.get(id);
      if (!current) return json({ error: { message: "Not Found", errors: [{ reason: "notFound" }] } }, 404);
      if (method === "GET") return json(current);
      if (method === "PATCH") {
        fake.events.set(id, { ...current, ...(body as Partial<FakeEvent>) });
        return json(fake.events.get(id));
      }
    }
  }
  if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return realFetch(input, init);
  throw new Error(`unexpected ${method} ${url.href}`);
}

/** An event on the calendar, `days` from now, an hour long, with a Zoom link. */
function event(id: string, days: number, summary = NAME, extra: Partial<FakeEvent> = {}): FakeEvent {
  const start = new Date(Date.now() + days * DAY);
  const made = {
    id,
    summary,
    status: "confirmed",
    start: { dateTime: start.toISOString() },
    end: { dateTime: new Date(start.getTime() + 60 * 60_000).toISOString() },
    location: `https://harness-io.zoom.us/j/${ZOOM_ID}?pwd=x`,
    attendees: [],
    ...extra,
  };
  fake.events.set(id, made);
  return made;
}

/* ------------------------------------------------------------------ */
/* Setup                                                               */
/* ------------------------------------------------------------------ */

async function candidate(key: string, track: "sales" | "engineer") {
  const email = `${TEST_PREFIX}${key}@${TEST_EMAIL_DOMAIN}`;
  await db.insert(employees).values({
    id: `${TEST_PREFIX}${key}`,
    email,
    fullName: `Attendee ${key}`,
    title: "Account Executive",
    track,
    orgDepth: 2,
    startDate: today,
    activeEffectiveDate: today,
    raw: {},
  });
  return email.toLowerCase();
}

async function connect({ zoom = true }: { zoom?: boolean } = {}) {
  const result = await saveGoogleConnection(admin.id, { email: ORGANIZER, refreshToken: sealSecret("refresh"), scope: "openid email https://www.googleapis.com/auth/calendar" });
  assert.ok(result.ok);
  if (zoom) {
    await saveZoomConnection(admin.id, {
      email: ZOOM_USER,
      tokens: { accessToken: "zoom-access", refreshToken: "zoom-refresh", expiresAt: new Date(Date.now() + 3_600_000), scope: "meeting:read:list_past_instances" },
    });
  }
}

async function pick(stage: "bootcamp" | "intermediate" = "bootcamp", track: "sales" | "engineer" | "both" = "sales", name = NAME, allOccurrences = false) {
  const made = await createMeetingSelection(admin.id, { name, stage, track, allOccurrences });
  assert.ok(made.ok);
  return made.meeting.id;
}

const sync = (preview = false) => runMeetingSync("manual", admin.id, Date.now() + 60_000, { preview });

async function sync_ok(preview = false) {
  const result = await sync(preview);
  assert.ok(result.ok, JSON.stringify(result));
  return result;
}

async function invitesOf(meetingId: string) {
  return db
    .select({ eventId: meetingOccurrences.eventId, email: meetingInvites.email, role: meetingInvites.role, test: meetingInvites.test, attendance: meetingInvites.attendance })
    .from(meetingInvites)
    .innerJoin(meetingOccurrences, eq(meetingOccurrences.id, meetingInvites.occurrenceId))
    .where(eq(meetingOccurrences.meetingId, meetingId));
}

/** The calendar events stored as a meeting's occurrences, soonest first. */
async function occurrenceEvents(meetingId: string) {
  const rows = await db
    .select({ eventId: meetingOccurrences.eventId })
    .from(meetingOccurrences)
    .where(eq(meetingOccurrences.meetingId, meetingId))
    .orderBy(meetingOccurrences.startsAt);
  return rows.map((r) => r.eventId);
}

/** An occurrence that is over, stored as an earlier sync would have, with `email` invited to it. */
async function pastOccurrence(meetingId: string, email: string, daysAgo = 2) {
  const startsAt = new Date(Date.now() - daysAgo * DAY);
  const [occ] = await db
    .insert(meetingOccurrences)
    .values({
      meetingId,
      eventId: `past${daysAgo}`,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 60 * 60_000),
      startDate: startsAt.toISOString().slice(0, 10),
      zoomMeetingId: ZOOM_ID,
    })
    .returning({ id: meetingOccurrences.id });
  await db.insert(meetingInvites).values({ occurrenceId: occ!.id, email, role: "member" });
  fake.instances.set(ZOOM_ID, [{ uuid: "/abc//def==", start_time: startsAt.toISOString() }]);
  return occ!.id;
}

let salesEmail: string;
let engineerEmail: string;

before(async () => {
  await scope.setUp();
  [saved] = await db.select().from(googleConnections).where(eq(googleConnections.key, GOOGLE_CONNECTION_KEY));
  [savedZoom] = await db.select().from(zoomConnections).where(eq(zoomConnections.key, ZOOM_CONNECTION_KEY));
  const keys = [EVALS_SETTINGS_KEYS.meetingSyncLive, EVALS_SETTINGS_KEYS.testGroupOn, EVALS_SETTINGS_KEYS.testGroupMembers, EVALS_SETTINGS_KEYS.testGroupSuffix];
  savedSettings = await db.select().from(evalsSettings).where(inArray(evalsSettings.key, keys));
  await db.delete(employees).where(like(employees.id, `${TEST_PREFIX}%`));
  admin = await scope.createUser("admin", PERSONAS.assessmentsAdmin);
  salesEmail = await candidate("gm_sales", "sales");
  engineerEmail = await candidate("gm_engineer", "engineer");

  // Occurrences up to 8 days out must fall before the bootcamp starts.
  const id = await scope.activeBootcamp(admin.id);
  const [row] = await db.select({ startDate: bootcamps.startDate }).from(bootcamps).where(eq(bootcamps.id, id));
  const wanted = new Date(Date.now() + 10 * DAY).toISOString().slice(0, 10);
  bootcamp = { id, startDate: wanted, movedFrom: null };
  if (row!.startDate < wanted) {
    bootcamp.movedFrom = row!.startDate;
    await db.update(bootcamps).set({ startDate: wanted }).where(eq(bootcamps.id, id));
  } else {
    bootcamp.startDate = row!.startDate;
  }
  globalThis.fetch = fakeFetch as typeof fetch;
  process.env.ZOOM_CLIENT_ID = "zoom-id";
  process.env.ZOOM_CLIENT_SECRET = "zoom-secret";
});

beforeEach(async () => {
  fake.reset();
  await db.delete(meetingSelections).where(like(meetingSelections.name, `${TEST_PREFIX}%`));
  await db.delete(meetingSyncRuns).where(eq(meetingSyncRuns.status, "running"));
  await db.delete(googleConnections).where(eq(googleConnections.key, GOOGLE_CONNECTION_KEY));
  await db.delete(zoomConnections).where(eq(zoomConnections.key, ZOOM_CONNECTION_KEY));
  await saveTestGroup(admin.id, { on: false });
  await setMeetingSyncLive(admin.id, true);
});

after(async () => {
  globalThis.fetch = realFetch;
  await db.delete(meetingSelections).where(like(meetingSelections.name, `${TEST_PREFIX}%`));
  await db.delete(googleConnections).where(eq(googleConnections.key, GOOGLE_CONNECTION_KEY));
  if (saved) await db.insert(googleConnections).values(saved);
  await db.delete(zoomConnections).where(eq(zoomConnections.key, ZOOM_CONNECTION_KEY));
  if (savedZoom) await db.insert(zoomConnections).values(savedZoom);
  const keys = [EVALS_SETTINGS_KEYS.meetingSyncLive, EVALS_SETTINGS_KEYS.testGroupOn, EVALS_SETTINGS_KEYS.testGroupMembers, EVALS_SETTINGS_KEYS.testGroupSuffix];
  await db.delete(evalsSettings).where(inArray(evalsSettings.key, keys));
  if (savedSettings.length > 0) await db.insert(evalsSettings).values(savedSettings);
  if (bootcamp?.movedFrom) await db.update(bootcamps).set({ startDate: bootcamp.movedFrom }).where(eq(bootcamps.id, bootcamp.id));
  await db.delete(employees).where(like(employees.id, `${TEST_PREFIX}%`));
  await scope.tearDown();
});

/* ------------------------------------------------------------------ */

describe("picked meetings", () => {
  test("are listed by name, and a name already picked is refused whatever its case", async () => {
    await pick("intermediate", "engineer");
    assert.deepEqual(await createMeetingSelection(admin.id, { name: NAME.toUpperCase(), stage: "bootcamp", track: "sales" }), { ok: false, error: "duplicate" });
    const page = await listMeetingSelections({ ...MEETING_SELECTION_LIST, q: TEST_PREFIX, page: 1 });
    assert.deepEqual(
      page.rows.map((r) => [r.name, r.stage, r.track, r.syncedAt]),
      [[NAME, "intermediate", "engineer", null]],
    );
  });

  test("the picker lists each name on the calendar once, leaving out all-day and cancelled events", async () => {
    await connect();
    event("a1", 1);
    event("a2", 4, `  ${NAME.toLowerCase()} `);
    event("b1", 2, `${TEST_PREFIX}Cancelled`, { status: "cancelled" });
    event("c1", 3, `${TEST_PREFIX}All day`, { start: { date: today }, end: { date: today } });
    const result = await upcomingMeetingNames();
    assert.ok(result.ok);
    const ours = result.names.filter((n) => n.name.toLowerCase().startsWith(TEST_PREFIX));
    assert.deepEqual(
      ours.map((n) => [n.name, n.occurrences]),
      [[NAME, 2]],
    );
  });

  test("the picker is refused with no account connected", async () => {
    const result = await upcomingMeetingNames();
    assert.equal(result.ok ? null : result.error, "not_connected");
  });
});

describe("the connection", () => {
  test("never shows its token, and a different account is refused only while an old-flow invite is on its calendar", async () => {
    await connect();
    const status = await googleConnectionStatus();
    assert.equal(status?.email, ORGANIZER);
    assert.ok(!("refreshToken" in (status ?? {})));

    const other = { email: `other@${TEST_EMAIL_DOMAIN}`, refreshToken: sealSecret("r"), scope: "" };
    const [legacy] = await db
      .insert(googleMeetings)
      .values({ title: `${TEST_PREFIX}Old`, startsAt: new Date(Date.now() + DAY), durationMinutes: 30, googleEventId: "old1", createdBy: admin.id })
      .returning({ id: googleMeetings.id });
    assert.deepEqual(await saveGoogleConnection(admin.id, other), { ok: false, error: "different_account", current: ORGANIZER });
    await db.delete(googleMeetings).where(eq(googleMeetings.id, legacy!.id));
    assert.deepEqual(await saveGoogleConnection(admin.id, other), { ok: true, replaced: true });
  });
});

describe("Sync Now", () => {
  test("is refused with no account connected", async () => {
    const result = await sync();
    assert.equal(result.ok ? null : result.error, "not_connected");
  });

  test("a second sync while one runs is turned away", async () => {
    await connect();
    await db.insert(meetingSyncRuns).values({ triggeredBy: admin.id, dryRun: true });
    const result = await sync();
    assert.equal(result.ok ? null : result.error, "already_running");
  });

  test("a dry run logs whom it would invite, stores the occurrences it read, and changes no invite", async () => {
    await connect();
    const id = await pick();
    event("e1", 1);
    const result = await sync_ok(true);
    assert.equal(result.dryRun, true);
    assert.deepEqual(fake.writes(), []);
    assert.deepEqual(await invitesOf(id), []);
    assert.deepEqual(await occurrenceEvents(id), ["e1"]);
    const [row] = await db.select({ syncedAt: meetingSelections.syncedAt }).from(meetingSelections).where(eq(meetingSelections.id, id));
    assert.equal(row!.syncedAt, null);
    const changes = await listMeetingSyncChanges(result.runId, { ...MEETING_SYNC_CHANGE_LIST, q: salesEmail, page: 1 });
    assert.deepEqual(
      changes.rows.map((c) => [c.action, c.email]),
      [["invited", salesEmail]],
    );
  });

  test("after a dry run the Current tab lists every occurrence of a meeting that invites to all of them, and a live run invites to the same ones", async () => {
    await connect();
    const id = await pick("bootcamp", "sales", NAME, true);
    event("e1", 1);
    event("e2", 2);
    event("e3", 3);
    await sync_ok(true);
    const [status] = (await meetingStatusesFor([{ email: salesEmail, stage: "bootcamp", track: "sales" }])).get(salesEmail)!;
    assert.equal(status!.mark, "uninvited");
    assert.equal(status!.predicted, true);
    assert.deepEqual(status!.instances?.map((x) => x.mark), ["uninvited", "uninvited", "uninvited"]);
    assert.deepEqual(fake.writes(), []);

    await sync_ok();
    assert.deepEqual(await occurrenceEvents(id), ["e1", "e2", "e3"]);
    const mine = (await invitesOf(id)).filter((inv) => inv.email === salesEmail).map((inv) => inv.eventId);
    assert.deepEqual(mine.sort(), ["e1", "e2", "e3"]);
  });

  test("a dry run forgets an occurrence no longer on the calendar", async () => {
    await connect();
    const id = await pick();
    event("e1", 1);
    event("e2", 8);
    await sync_ok(true);
    fake.events.delete("e2");
    await sync_ok(true);
    assert.deepEqual(await occurrenceEvents(id), ["e1"]);
  });

  test("after a dry run, someone with no occurrence in their window has none left", async (t) => {
    await connect();
    const id = await pick();
    const [row] = await db.select({ btcDays: bootcamps.btcDays, intDays: bootcamps.intDays }).from(bootcamps).where(eq(bootcamps.id, bootcamp.id));
    const lastDay = new Date(`${bootcamp.startDate}T00:00:00Z`).getTime() + (Math.max(row!.btcDays, row!.intDays ?? 0, 1) - 1) * DAY;
    const afterDays = Math.ceil((lastDay - Date.now()) / DAY) + 2;
    if (afterDays > 55) return t.skip("the active bootcamp ends past the calendar's 60 days");
    event("e1", afterDays);
    await sync_ok(true);
    const statuses = (await meetingStatusesFor([{ email: salesEmail, stage: "bootcamp", track: "sales" }])).get(salesEmail)!;
    assert.equal(statuses.find((x) => x.meetingId === id)!.mark, "none_left");
  });

  test("invites whom the meeting is for to its next occurrence, with the administrators, and sends nothing twice", async () => {
    await connect();
    const id = await pick();
    event("e1", 1);
    event("e2", 5);
    const first = await sync_ok();
    assert.equal(first.dryRun, false);

    const guests = fake.guests("e1");
    assert.ok(guests.includes(salesEmail), "the Bootcamp Sales candidate is invited");
    assert.ok(!guests.includes(engineerEmail), "an engineer is not");
    assert.ok(guests.includes(admin.email), "the administrator is");
    assert.ok(!fake.guests("e2").includes(salesEmail), "to one occurrence only");
    const patch = fake.calls.find((c) => c.method === "PATCH")!;
    assert.equal(patch.url.searchParams.get("sendUpdates"), "none", "Google emails no one");
    assert.deepEqual(
      (await invitesOf(id)).filter((i) => i.email === salesEmail || i.email === admin.email).map((i) => [i.eventId, i.email, i.role]).sort(),
      [
        ["e1", admin.email, "administrator"],
        ["e1", salesEmail, "member"],
      ].sort(),
    );

    fake.calls = [];
    await sync_ok();
    assert.deepEqual(fake.writes(), [], "an invite already right is left alone");
  });

  test("all meetings invites to every occurrence before the bootcamp, and one at a time takes the extras back", async () => {
    await connect();
    const id = await pick("bootcamp", "sales", NAME, true);
    event("e1", 1);
    event("e2", 5);
    await sync_ok();
    assert.ok(fake.guests("e1").includes(salesEmail) && fake.guests("e2").includes(salesEmail), "on both");
    assert.ok(fake.guests("e2").includes(admin.email), "with the administrator on each");

    assert.ok((await updateMeetingSelection(id, { allOccurrences: false })).ok);
    await sync_ok();
    assert.ok(fake.guests("e1").includes(salesEmail), "keeps the first");
    assert.ok(!fake.guests("e2").includes(salesEmail), "and loses the rest");
  });

  test("an intermediate meeting invites a bootcamp candidate only once they RSVP, and only after the bootcamp", async (t) => {
    const [row] = await db.select({ btcDays: bootcamps.btcDays, intDays: bootcamps.intDays }).from(bootcamps).where(eq(bootcamps.id, bootcamp.id));
    const lastDay = new Date(`${bootcamp.startDate}T00:00:00Z`).getTime() + (Math.max(row!.btcDays, row!.intDays ?? 0, 1) - 1) * DAY;
    const afterDays = Math.ceil((lastDay - Date.now()) / DAY) + 2;
    if (afterDays > 55) return t.skip("the active bootcamp ends past the calendar's 60 days");
    await connect();
    const id = await pick("intermediate", "sales");
    event("e1", 1);
    event("e2", afterDays);
    try {
      await sync_ok();
      assert.ok(!fake.guests("e1").includes(salesEmail) && !fake.guests("e2").includes(salesEmail), "not before they RSVP");

      await db.insert(intakeResponses).values({ form: "bootcamp", email: salesEmail, answers: {} });
      await sync_ok();
      assert.ok(!fake.guests("e1").includes(salesEmail), "not before the bootcamp");
      assert.ok(fake.guests("e2").includes(salesEmail), "but after it");
      const [status] = (await meetingStatusesFor([{ email: salesEmail, stage: "bootcamp", track: "sales" }])).get(salesEmail)!;
      assert.equal(status?.meetingId, id);
      assert.equal(status?.mark, "pending");
    } finally {
      await db.delete(intakeResponses).where(eq(intakeResponses.email, salesEmail));
    }
  });

  test("a guest's reply is read back, and shows on the Current tab", async () => {
    await connect();
    const id = await pick();
    event("e1", 1);
    await sync_ok();
    let [status] = (await meetingStatusesFor([{ email: salesEmail, stage: "bootcamp", track: "sales" }])).get(salesEmail)!;
    assert.deepEqual([status!.meetingId, status!.mark], [id, "pending"]);

    fake.events.get("e1")!.attendees = fake.events.get("e1")!.attendees!.map((a) => (a.email === salesEmail ? { ...a, responseStatus: "accepted" } : a));
    await sync_ok();
    [status] = (await meetingStatusesFor([{ email: salesEmail, stage: "bootcamp", track: "sales" }])).get(salesEmail)!;
    assert.equal(status!.mark, "accepted");
  });

  test("the Current tab gives someone not yet invited the occurrence the next sync would pick, and flags one outside 9 to 5", async () => {
    await connect();
    const id = await pick();
    // 13:00 to 14:00 UTC two days out: before 9:00 in Chicago, mid-afternoon in London.
    const day = new Date(Date.now() + 2 * DAY).toISOString().slice(0, 10);
    const startsAt = `${day}T13:00:00.000Z`;
    event("e1", 2, NAME, { start: { dateTime: startsAt }, end: { dateTime: `${day}T14:00:00.000Z` } });
    event("e2", 5);
    await sync_ok();
    // As if they joined the cohort after this sync: on no invite yet.
    const [occ] = await db.select({ id: meetingOccurrences.id }).from(meetingOccurrences).where(and(eq(meetingOccurrences.meetingId, id), eq(meetingOccurrences.eventId, "e1")));
    await db.delete(meetingInvites).where(and(eq(meetingInvites.occurrenceId, occ!.id), eq(meetingInvites.email, salesEmail)));
    const status = async () => (await meetingStatusesFor([{ email: salesEmail, stage: "bootcamp", track: "sales" }])).get(salesEmail)![0]!;
    try {
      await db.update(employees).set({ timezone: "America/Chicago" }).where(eq(employees.email, salesEmail));
      const chicago = await status();
      assert.deepEqual([chicago.mark, chicago.predicted, chicago.startsAt?.toISOString(), chicago.timezone, chicago.outOfHours], ["uninvited", true, startsAt, "America/Chicago", true]);

      await db.update(employees).set({ timezone: "Europe/London" }).where(eq(employees.email, salesEmail));
      assert.equal((await status()).outOfHours, false);

      await db.update(employees).set({ timezone: null }).where(eq(employees.email, salesEmail));
      const none = await status();
      assert.deepEqual([none.predicted, none.outOfHours], [true, false]);

      await sync_ok();
      const invited = await status();
      assert.deepEqual([invited.mark, invited.predicted, invited.startsAt?.toISOString()], ["pending", false, startsAt], "the sync invites them to the one predicted");
    } finally {
      await db.update(employees).set({ timezone: null }).where(eq(employees.email, salesEmail));
    }
  });

  test("the Current tab lists every occurrence of a meeting that invites to all of them, with how each stands", async () => {
    await connect();
    const id = await pick("bootcamp", "sales", NAME, true);
    await pastOccurrence(id, salesEmail);
    fake.participants.set("/abc//def==", [{ name: "Someone Else", user_email: `else@${TEST_EMAIL_DOMAIN}` }]);
    event("e1", 2);
    event("e2", 5);
    await sync_ok();
    // As if the sync had not reached e2 for them yet: the next one adds it.
    const [occ] = await db.select({ id: meetingOccurrences.id }).from(meetingOccurrences).where(and(eq(meetingOccurrences.meetingId, id), eq(meetingOccurrences.eventId, "e2")));
    await db.delete(meetingInvites).where(and(eq(meetingInvites.occurrenceId, occ!.id), eq(meetingInvites.email, salesEmail)));
    const [status] = (await meetingStatusesFor([{ email: salesEmail, stage: "bootcamp", track: "sales" }])).get(salesEmail)!;
    assert.equal(status!.mark, "pending");
    assert.deepEqual(status!.instances?.map((x) => x.mark), ["missed", "pending", "uninvited"]);
    const starts = status!.instances!.map((x) => x.startsAt.getTime());
    assert.deepEqual(starts, [...starts].sort((a, b) => a - b), "soonest first");

    assert.ok((await updateMeetingSelection(id, { allOccurrences: false })).ok);
    const [single] = (await meetingStatusesFor([{ email: salesEmail, stage: "bootcamp", track: "sales" }])).get(salesEmail)!;
    assert.equal(single!.instances, null, "one at a time has no instances");
  });

  test("someone Zoom did not see join is counted missing and invited to the next occurrence", async () => {
    await connect();
    const id = await pick();
    await pastOccurrence(id, salesEmail);
    fake.participants.set("/abc//def==", [{ name: "Someone Else", user_email: `else@${TEST_EMAIL_DOMAIN}` }]);
    event("e1", 1);
    const result = await sync_ok();
    assert.ok(result.missed >= 1);

    const mine = (await invitesOf(id)).filter((i) => i.email === salesEmail);
    assert.deepEqual(mine.map((i) => [i.eventId, i.attendance]).sort(), [
      ["e1", null],
      ["past2", "missed"],
    ]);
    const changes = await listMeetingSyncChanges(result.runId, { ...MEETING_SYNC_CHANGE_LIST, q: salesEmail, page: 1 });
    assert.ok(changes.rows.some((c) => c.action === "invited" && c.detail === "Missed an earlier one."));
    // The past session's uuid starts with `/`, so Zoom wants it encoded twice.
    assert.ok(fake.calls.some((c) => c.url.pathname.includes("%252Fabc%252F%252Fdef%253D%253D")));
  });

  test("someone Zoom saw join, by their full name, is done and not invited again", async () => {
    await connect();
    const id = await pick();
    await pastOccurrence(id, salesEmail);
    fake.participants.set("/abc//def==", [{ name: "attendee  GM_SALES" }]);
    event("e1", 1);
    await sync_ok();
    assert.ok(!fake.guests("e1").includes(salesEmail));
    const [status] = (await meetingStatusesFor([{ email: salesEmail, stage: "bootcamp", track: "sales" }])).get(salesEmail)!;
    assert.deepEqual([status!.mark, status!.marked], ["attended", null]);
  });

  test("an administrator's mark overrides Zoom, and takes them off what is still to come", async () => {
    await connect();
    const id = await pick();
    event("e1", 1);
    await sync_ok();
    assert.ok(fake.guests("e1").includes(salesEmail));

    assert.ok((await setAttendanceMark(admin.id, id, { email: salesEmail, attended: true })).ok);
    await sync_ok();
    assert.ok(!fake.guests("e1").includes(salesEmail), "taken off the invite they no longer need");
    const [status] = (await meetingStatusesFor([{ email: salesEmail, stage: "bootcamp", track: "sales" }])).get(salesEmail)!;
    assert.deepEqual([status!.mark, status!.marked], ["attended", true]);
  });

  test("with no occurrence left before the bootcamp, no one is invited and the Current tab says so", async () => {
    await connect();
    const id = await pick();
    // On the bootcamp's first day: too late.
    const late = Math.ceil((Date.parse(`${bootcamp.startDate}T12:00:00Z`) - Date.now()) / DAY);
    event("late", late);
    const result = await sync_ok();
    assert.ok(result.noneLeft >= 1);
    assert.ok(!fake.guests("late").includes(salesEmail));
    const [status] = (await meetingStatusesFor([{ email: salesEmail, stage: "bootcamp", track: "sales" }])).get(salesEmail)!;
    assert.deepEqual([status!.meetingId, status!.mark], [id, "none_left"]);
  });

  test("a guest added by hand stays when the meeting stops being for them", async () => {
    await connect();
    const id = await pick();
    event("e1", 1);
    await sync_ok();
    const byHand = `by.hand@${TEST_EMAIL_DOMAIN}`;
    fake.events.get("e1")!.attendees!.push({ email: byHand, responseStatus: "accepted" });

    assert.ok((await updateMeetingSelection(id, { track: "engineer" })).ok);
    await sync_ok();
    const guests = fake.guests("e1");
    assert.ok(guests.includes(engineerEmail));
    assert.ok(!guests.includes(salesEmail), "the sync takes off the Sales candidate it added");
    assert.ok(guests.includes(byHand), "but not someone added by hand");
  });

  test("the test group stands in for the cohort, with no administrators, and turning it off takes its invites back", async () => {
    await connect();
    const id = await pick("bootcamp", "both");
    event("e1", 1);
    const tester = `${TEST_PREFIX}tester@${TEST_EMAIL_DOMAIN}`;
    await saveTestGroup(admin.id, { on: true, suffix: "test", members: [{ email: tester, fullName: "Tester", stage: "both" }] });

    const result = await sync_ok();
    assert.equal(result.testGroup, true);
    const guests = fake.guests("e1");
    assert.ok(guests.includes(tester));
    assert.ok(!guests.includes(salesEmail) && !guests.includes(admin.email));
    assert.deepEqual(
      (await invitesOf(id)).map((i) => [i.email, i.test]),
      [[tester, true]],
    );

    const cancelled = await cancelTestMeetingInvites();
    assert.deepEqual(cancelled.failures, []);
    assert.ok(!fake.guests("e1").includes(tester));
    assert.deepEqual(await invitesOf(id), []);
  });

  test("reading the test group's attendance leaves the cohort's unread, to be read when the group is off", async () => {
    await connect();
    const id = await pick("bootcamp", "both");
    const tester = `${TEST_PREFIX}tester@${TEST_EMAIL_DOMAIN}`;
    const occurrenceId = await pastOccurrence(id, salesEmail);
    await db.insert(meetingInvites).values({ occurrenceId, email: tester, role: "member", test: true });
    fake.participants.set("/abc//def==", [{ name: "Tester", user_email: tester }]);
    await saveTestGroup(admin.id, { on: true, suffix: "test", members: [{ email: tester, fullName: "Tester", stage: "both" }] });

    await sync_ok();
    const attendance = async () => new Map((await invitesOf(id)).filter((i) => i.eventId === "past2").map((i) => [i.email, i.attendance]));
    const readAt = async () => (await db.select({ at: meetingOccurrences.attendanceReadAt }).from(meetingOccurrences).where(eq(meetingOccurrences.id, occurrenceId)))[0]!.at;
    assert.equal((await attendance()).get(tester), "attended");
    assert.equal((await attendance()).get(salesEmail), null, "the cohort's invite is not the test group's to read");
    assert.equal(await readAt(), null, "so the occurrence is not marked read");

    await saveTestGroup(admin.id, { on: false });
    await sync_ok();
    assert.equal((await attendance()).get(salesEmail), "missed", "read from Zoom once the group is off");
    assert.notEqual(await readAt(), null);
  });

  test("deleting a meeting first takes back only the invites the sync sent", async () => {
    await connect();
    const id = await pick();
    event("e1", 1);
    await sync_ok();
    const byHand = `by.hand@${TEST_EMAIL_DOMAIN}`;
    fake.events.get("e1")!.attendees!.push({ email: byHand });

    const taken = await takeMeetingGuestsOff(id);
    assert.ok(taken.ok);
    assert.equal(taken.events, 1);
    assert.deepEqual(fake.guests("e1"), [byHand]);
  });

  test("a live run cancels the old create-a-meeting flow's upcoming invites, once", async () => {
    await connect();
    await db.update(googleConnections).set({ calendarId: "old-calendar" }).where(eq(googleConnections.key, GOOGLE_CONNECTION_KEY));
    await db
      .insert(googleMeetings)
      .values({ title: `${TEST_PREFIX}Old`, startsAt: new Date(Date.now() + DAY), durationMinutes: 30, googleEventId: "old1", zoomMeetingId: "555", createdBy: admin.id });
    const result = await sync_ok();
    assert.ok(fake.calls.some((c) => c.method === "DELETE" && c.url.pathname.endsWith("/events/old1") && c.url.searchParams.get("sendUpdates") === "none"));
    assert.ok(fake.calls.some((c) => c.method === "DELETE" && c.url.pathname === "/v2/meetings/555"));
    const changes = await listMeetingSyncChanges(result.runId, { ...MEETING_SYNC_CHANGE_LIST, q: `${TEST_PREFIX}Old`, page: 1 });
    assert.deepEqual(
      changes.rows.map((c) => c.action),
      ["cancelled"],
    );
    assert.deepEqual(await db.select().from(googleMeetings).where(and(like(googleMeetings.title, `${TEST_PREFIX}%`))), []);
  });
});
