/**
 * Google Meetings against a real database, with Google and Zoom played by a
 * fake `fetch`: saving and listing meetings, connecting an account, and what
 * Sync Now and a delete send. Nothing leaves the machine.
 *
 * The connection is one row for the whole database. If the scratch database
 * already has one, the suite puts it back afterwards. Meetings are made by
 * this suite's users, so cleanup finds them; employees carry `TEST_PREFIX`.
 */

import "../support/test-env";

import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { eq, like } from "drizzle-orm";

process.env.AUTH_SECRET ||= "google-meetings-test-secret-google-meetings";
process.env.AUTH_GOOGLE_ID = "test-client-id";
process.env.AUTH_GOOGLE_SECRET = "test-client-secret";

import { db } from "@/db";
import { employees, GOOGLE_CONNECTION_KEY, googleConnections, googleMeetings } from "@/db/schema";
import {
  createGoogleMeeting,
  googleConnectionStatus,
  googleMeeting,
  listGoogleMeetings,
  saveGoogleConnection,
  type GoogleConnection,
  updateGoogleMeeting,
} from "@/lib/evals/google-meetings";
import { cancelGoogleMeeting, syncGoogleMeetings } from "@/lib/evals/google-meetings-sync";
import { GOOGLE_MEETING_LIST } from "@/lib/list-specs";
import { sealSecret } from "@/lib/secret-box";
import { PERSONAS } from "../support/access";
import { TEST_EMAIL_DOMAIN, TEST_PREFIX } from "../support/db";
import { testScope, type TestUser } from "../support/seed";

const scope = testScope("gmeet");
const today = new Date().toISOString().slice(0, 10);
const ORGANIZER = `${TEST_PREFIX}organizer@${TEST_EMAIL_DOMAIN}`;

let admin: TestUser;
let saved: GoogleConnection | null = null;

/* ------------------------------------------------------------------ */
/* Google and Zoom, played by a fake fetch                             */
/* ------------------------------------------------------------------ */

type Call = { method: string; url: URL; body: Record<string, unknown> | null };

const fake = {
  calls: [] as Call[],
  events: new Map<string, Record<string, unknown>>(),
  zoomMeetings: new Map<string, Record<string, unknown>>(),
  acl: [] as { id: string; role: string; scope: { type: string; value: string } }[],
  zoomUsers: new Set<string>(),
  nextId: 1,
  reset() {
    this.calls = [];
    this.events.clear();
    this.zoomMeetings.clear();
    this.acl = [];
    this.zoomUsers.clear();
  },
  /** The calls that changed something, as `METHOD path`. */
  writes() {
    return this.calls.filter((c) => c.method !== "GET" && !c.url.pathname.endsWith("/token")).map((c) => `${c.method} ${c.url.pathname}`);
  },
};

const json = (body: unknown, status = 200) =>
  new Response(body === null ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const realFetch = globalThis.fetch;

async function fakeFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const method = init?.method ?? "GET";
  const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
  fake.calls.push({ method, url, body });
  const path = url.pathname;

  if (url.host === "oauth2.googleapis.com") return json({ access_token: "google-token" });
  if (url.host === "zoom.us") return json({ access_token: "zoom-token" });

  if (url.host === "api.zoom.us") {
    const user = /^\/v2\/users\/([^/]+)$/.exec(path);
    if (user && method === "GET") {
      const email = decodeURIComponent(user[1]!);
      return fake.zoomUsers.has(email) ? json({ email, status: "active" }) : json({ code: 1001, message: "User does not exist" }, 404);
    }
    if (/^\/v2\/users\/[^/]+\/meetings$/.test(path) && method === "POST") {
      const id = String(fake.nextId++);
      const made = { ...body, id: Number(id), join_url: `https://zoom.us/j/${id}` };
      fake.zoomMeetings.set(id, made);
      return json(made, 201);
    }
    const meeting = /^\/v2\/meetings\/([^/]+)$/.exec(path);
    if (meeting) {
      const id = meeting[1]!;
      const current = fake.zoomMeetings.get(id);
      if (!current) return json({ code: 3001, message: "Meeting does not exist" }, 404);
      if (method === "GET") return json(current);
      if (method === "PATCH") {
        fake.zoomMeetings.set(id, { ...current, ...body, settings: { ...(current.settings as object), ...(body?.settings as object) } });
        return new Response(null, { status: 204 });
      }
      if (method === "DELETE") {
        fake.zoomMeetings.delete(id);
        return new Response(null, { status: 204 });
      }
    }
  }

  if (url.host === "www.googleapis.com") {
    if (path === "/calendar/v3/calendars" && method === "POST") return json({ id: "meetings-calendar" });
    if (path === "/calendar/v3/calendars/meetings-calendar" && method === "GET") return json({ id: "meetings-calendar" });
    if (path === "/calendar/v3/calendars/meetings-calendar/acl") {
      if (method === "GET") return json({ items: fake.acl });
      const rule = { id: `user:${(body!.scope as { value: string }).value}`, role: body!.role as string, scope: body!.scope as { type: string; value: string } };
      fake.acl.push(rule);
      return json(rule);
    }
    const aclRule = /^\/calendar\/v3\/calendars\/meetings-calendar\/acl\/(.+)$/.exec(path);
    if (aclRule && method === "DELETE") {
      fake.acl = fake.acl.filter((r) => r.id !== decodeURIComponent(aclRule[1]!));
      return new Response(null, { status: 204 });
    }
    if (path === "/calendar/v3/calendars/meetings-calendar/events" && method === "POST") {
      const id = `event${fake.nextId++}`;
      fake.events.set(id, { ...body, id, status: "confirmed" });
      return json({ id });
    }
    const event = /^\/calendar\/v3\/calendars\/meetings-calendar\/events\/([^/]+)$/.exec(path);
    if (event) {
      const id = event[1]!;
      const current = fake.events.get(id);
      if (!current) return json({ error: { message: "Not Found", errors: [{ reason: "notFound" }] } }, 404);
      if (method === "GET") return json(current);
      if (method === "PATCH") {
        fake.events.set(id, { ...current, ...body });
        return json(fake.events.get(id));
      }
      if (method === "DELETE") {
        fake.events.delete(id);
        return new Response(null, { status: 204 });
      }
    }
  }
  if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return realFetch(input, init);
  throw new Error(`unexpected ${method} ${url.href}`);
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
  return email;
}

const inAnHour = () => new Date(Date.now() + 60 * 60_000).toISOString();

async function connect() {
  const result = await saveGoogleConnection(admin.id, { email: ORGANIZER, refreshToken: sealSecret("refresh"), scope: "openid email https://www.googleapis.com/auth/calendar" });
  assert.ok(result.ok);
}

let salesEmail: string;
let engineerEmail: string;

before(async () => {
  await scope.setUp();
  [saved] = await db.select().from(googleConnections).where(eq(googleConnections.key, GOOGLE_CONNECTION_KEY));
  await db.delete(googleConnections).where(eq(googleConnections.key, GOOGLE_CONNECTION_KEY));
  await db.delete(employees).where(like(employees.id, `${TEST_PREFIX}%`));
  admin = await scope.createUser("admin", PERSONAS.assessmentsAdmin);
  salesEmail = await candidate("gm_sales", "sales");
  engineerEmail = await candidate("gm_engineer", "engineer");
  globalThis.fetch = fakeFetch as typeof fetch;
  process.env.ZOOM_ACCOUNT_ID = "acct";
  process.env.ZOOM_CLIENT_ID = "zoom-id";
  process.env.ZOOM_CLIENT_SECRET = "zoom-secret";
});

beforeEach(async () => {
  fake.reset();
  fake.zoomUsers.add(admin.email);
  await db.delete(googleMeetings).where(like(googleMeetings.createdBy, `${TEST_PREFIX}%`));
  await db.delete(googleConnections).where(eq(googleConnections.key, GOOGLE_CONNECTION_KEY));
});

after(async () => {
  globalThis.fetch = realFetch;
  await db.delete(googleConnections).where(eq(googleConnections.key, GOOGLE_CONNECTION_KEY));
  if (saved) await db.insert(googleConnections).values(saved);
  await db.delete(employees).where(like(employees.id, `${TEST_PREFIX}%`));
  await scope.tearDown();
});

/* ------------------------------------------------------------------ */

describe("meetings", () => {
  test("are refused in the past, and listed upcoming until they end", async () => {
    assert.deepEqual(
      await createGoogleMeeting(admin.id, { title: "Too late", startsAt: new Date(Date.now() - 60_000).toISOString(), durationMinutes: 15, groups: [] }),
      { ok: false, error: "in_past" },
    );
    const made = await createGoogleMeeting(admin.id, { title: `${TEST_PREFIX}Kickoff`, startsAt: inAnHour(), durationMinutes: 30, groups: ["bootcamp_sales"] });
    assert.ok(made.ok);
    const upcoming = await listGoogleMeetings("upcoming", { ...GOOGLE_MEETING_LIST, q: TEST_PREFIX, page: 1 });
    assert.deepEqual(
      upcoming.rows.map((r) => [r.title, r.status, r.groups]),
      [[`${TEST_PREFIX}Kickoff`, "not_synced", ["bootcamp_sales"]]],
    );
    const past = await listGoogleMeetings("past", { ...GOOGLE_MEETING_LIST, q: TEST_PREFIX, page: 1 });
    assert.deepEqual(past.rows, []);
  });

  test("an edit that changes nothing does not mark the meeting changed", async () => {
    const made = await createGoogleMeeting(admin.id, { title: `${TEST_PREFIX}Same`, startsAt: inAnHour(), durationMinutes: 30, groups: [] });
    assert.ok(made.ok);
    const before = (await googleMeeting(made.meeting.id))!.changedAt;
    await updateGoogleMeeting(made.meeting.id, { title: `${TEST_PREFIX}Same`, groups: [] });
    assert.equal((await googleMeeting(made.meeting.id))!.changedAt.getTime(), before.getTime());
  });
});

describe("the connection", () => {
  test("never shows its token, and a different account is refused once a meeting has an invite", async () => {
    await connect();
    const status = await googleConnectionStatus();
    assert.equal(status?.email, ORGANIZER);
    assert.ok(!("refreshToken" in (status ?? {})));

    const made = await createGoogleMeeting(admin.id, { title: `${TEST_PREFIX}Has invite`, startsAt: inAnHour(), durationMinutes: 15, groups: [] });
    assert.ok(made.ok);
    await db.update(googleMeetings).set({ googleEventId: "x" }).where(eq(googleMeetings.id, made.meeting.id));
    assert.deepEqual(
      await saveGoogleConnection(admin.id, { email: `other@${TEST_EMAIL_DOMAIN}`, refreshToken: sealSecret("r"), scope: "" }),
      { ok: false, error: "different_account", current: ORGANIZER },
    );
    assert.deepEqual(await saveGoogleConnection(admin.id, { email: ORGANIZER, refreshToken: sealSecret("r2"), scope: "" }), { ok: true, replaced: true });
  });
});

describe("Sync Now", () => {
  test("is refused with no account connected", async () => {
    const result = await syncGoogleMeetings();
    assert.equal(result.ok ? null : result.error, "not_connected");
  });

  test("invites the group and the administrators, gives the administrators edit access and Zoom hosting, and sends nothing twice", async () => {
    await connect();
    const made = await createGoogleMeeting(admin.id, { title: `${TEST_PREFIX}Kickoff`, startsAt: inAnHour(), durationMinutes: 30, groups: ["bootcamp_sales"] });
    assert.ok(made.ok);

    const first = await syncGoogleMeetings();
    assert.ok(first.ok, JSON.stringify(first));
    const ours = first.meetings.find((m) => m.id === made.meeting.id);
    assert.equal(ours?.outcome, "created");

    const row = (await googleMeeting(made.meeting.id))!;
    const event = fake.events.get(row.googleEventId!)!;
    const guests = (event.attendees as { email: string }[]).map((a) => a.email);
    assert.ok(guests.includes(salesEmail), "the Bootcamp Sales candidate is invited");
    assert.ok(guests.includes(admin.email), "the administrator is invited");
    assert.ok(!guests.includes(engineerEmail), "an engineer is not");
    assert.equal(event.guestsCanModify, false, "the cohort cannot edit the invite");
    assert.equal(event.location, row.zoomJoinUrl);

    const create = fake.calls.find((c) => c.method === "POST" && c.url.pathname.endsWith("/events"))!;
    assert.equal(create.url.searchParams.get("sendUpdates"), "all");
    assert.deepEqual(fake.acl.map((r) => [r.scope.value, r.role]).filter(([e]) => e === admin.email), [[admin.email, "writer"]]);
    const zoom = fake.zoomMeetings.get(row.zoomMeetingId!)!;
    assert.ok(String((zoom.settings as { alternative_hosts: string }).alternative_hosts).split(";").includes(admin.email));
    assert.equal(zoom.start_time, row.startsAt.toISOString().replace(/\.\d{3}Z$/, "Z"));

    // Unchanged, the second sync reads and writes nothing for this meeting.
    fake.calls = [];
    const second = await syncGoogleMeetings();
    assert.ok(second.ok);
    assert.equal(second.meetings.find((m) => m.id === made.meeting.id)?.outcome, "unchanged");
    assert.deepEqual(
      fake.writes().filter((w) => w.includes(row.googleEventId!) || w.includes(`/meetings/${row.zoomMeetingId}`)),
      [],
    );
  });

  test("switching groups swaps the cohort but keeps a guest added by hand", async () => {
    await connect();
    const made = await createGoogleMeeting(admin.id, { title: `${TEST_PREFIX}Swap`, startsAt: inAnHour(), durationMinutes: 60, groups: ["bootcamp_sales"] });
    assert.ok(made.ok);
    assert.ok((await syncGoogleMeetings()).ok);

    const row = (await googleMeeting(made.meeting.id))!;
    const event = fake.events.get(row.googleEventId!)!;
    const byHand = `by.hand@${TEST_EMAIL_DOMAIN}`;
    event.attendees = [...(event.attendees as object[]), { email: byHand, responseStatus: "accepted" }];

    await updateGoogleMeeting(made.meeting.id, { groups: ["bootcamp_engineer"], title: `${TEST_PREFIX}Swapped` });
    assert.equal((await listGoogleMeetings("upcoming", { ...GOOGLE_MEETING_LIST, q: "Swapped", page: 1 })).rows[0]?.status, "changed");

    const result = await syncGoogleMeetings();
    assert.ok(result.ok);
    assert.equal(result.meetings.find((m) => m.id === made.meeting.id)?.outcome, "updated");
    const guests = (fake.events.get(row.googleEventId!)!.attendees as { email: string }[]).map((a) => a.email);
    assert.ok(guests.includes(engineerEmail));
    assert.ok(!guests.includes(salesEmail), "the sync takes off the Sales candidate it added");
    assert.ok(guests.includes(byHand), "but not someone added by hand");
    assert.equal(fake.events.get(row.googleEventId!)!.summary, `${TEST_PREFIX}Swapped`);
    assert.equal(fake.zoomMeetings.get(row.zoomMeetingId!)!.topic, `${TEST_PREFIX}Swapped`);
    assert.equal((await listGoogleMeetings("upcoming", { ...GOOGLE_MEETING_LIST, q: "Swapped", page: 1 })).rows[0]?.status, "synced");
  });

  test("an administrator with no Zoom user is still invited, but not made a host", async () => {
    await connect();
    fake.zoomUsers.clear();
    const made = await createGoogleMeeting(admin.id, { title: `${TEST_PREFIX}No zoom user`, startsAt: inAnHour(), durationMinutes: 15, groups: [] });
    assert.ok(made.ok);
    const result = await syncGoogleMeetings();
    assert.ok(result.ok);
    assert.ok(result.notes.some((n) => n.includes(admin.email) && n.includes("alternative host")));
    const row = (await googleMeeting(made.meeting.id))!;
    assert.ok(!String((fake.zoomMeetings.get(row.zoomMeetingId!)!.settings as { alternative_hosts: string }).alternative_hosts).includes(admin.email));
    assert.ok((fake.events.get(row.googleEventId!)!.attendees as { email: string }[]).some((a) => a.email === admin.email));
  });

  test("deleting a synced meeting cancels its invite, telling the guests, and its Zoom meeting", async () => {
    await connect();
    const made = await createGoogleMeeting(admin.id, { title: `${TEST_PREFIX}Cancel me`, startsAt: inAnHour(), durationMinutes: 15, groups: ["bootcamp_sales"] });
    assert.ok(made.ok);
    assert.ok((await syncGoogleMeetings()).ok);
    const row = (await googleMeeting(made.meeting.id))!;

    assert.deepEqual(await cancelGoogleMeeting(row), { ok: true });
    assert.equal(fake.events.has(row.googleEventId!), false);
    assert.equal(fake.zoomMeetings.has(row.zoomMeetingId!), false);
    const cancel = fake.calls.find((c) => c.method === "DELETE" && c.url.pathname.includes("/events/"))!;
    assert.equal(cancel.url.searchParams.get("sendUpdates"), "all");
  });

  test("a second sync while one runs is turned away", async () => {
    await connect();
    await db.update(googleConnections).set({ syncStartedAt: new Date() }).where(eq(googleConnections.key, GOOGLE_CONNECTION_KEY));
    const result = await syncGoogleMeetings();
    assert.equal(result.ok ? null : result.error, "running");
  });
});
