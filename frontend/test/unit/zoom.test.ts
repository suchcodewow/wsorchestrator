/** The Zoom OAuth calls Google Meetings makes: the consent URL, trading and renewing tokens, and which scopes count as enough. */

import { after, test } from "node:test";
import assert from "node:assert/strict";

import { alternativeHostsOf, authorizationUrl, createMeeting, exchangeCode, grantedScopes, refreshTokens, setAlternativeHosts, zoomClient, ZoomError } from "../../src/lib/zoom";

const realFetch = globalThis.fetch;
after(() => {
  globalThis.fetch = realFetch;
});

const app = { clientId: "client", clientSecret: "secret" };

function answer(body: unknown, status = 200) {
  const sent: { url: string; headers: Record<string, string>; form: URLSearchParams }[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    sent.push({
      url: String(input),
      headers: init?.headers as Record<string, string>,
      form: new URLSearchParams(String(init?.body)),
    });
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return sent;
}

test("the consent URL carries the app, the redirect and the state, and asks for no scopes of its own", () => {
  const url = new URL(authorizationUrl({ clientId: "client", redirectUri: "https://app.example/api/auth/callback/google", state: "wo.zoom-meetings.n" }));
  assert.equal(url.origin + url.pathname, "https://zoom.us/oauth/authorize");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("client_id"), "client");
  assert.equal(url.searchParams.get("redirect_uri"), "https://app.example/api/auth/callback/google");
  assert.equal(url.searchParams.get("state"), "wo.zoom-meetings.n");
  assert.equal(url.searchParams.has("scope"), false, "Zoom takes the scopes set on the app");
});

test("a code is traded for the user's tokens, with the app's credentials in the header", async () => {
  const sent = answer({ access_token: "a", refresh_token: "r", expires_in: 3600, scope: "meeting:write:meeting" });
  const tokens = await exchangeCode(app, "the-code", "https://app.example/cb");
  assert.equal(tokens.accessToken, "a");
  assert.equal(tokens.refreshToken, "r");
  assert.ok(tokens.expiresAt.getTime() > Date.now() + 3_000_000);
  assert.equal(sent[0]!.form.get("grant_type"), "authorization_code");
  assert.equal(sent[0]!.form.get("code"), "the-code");
  assert.equal(sent[0]!.form.get("redirect_uri"), "https://app.example/cb");
  assert.equal(sent[0]!.headers.Authorization, `Basic ${Buffer.from("client:secret").toString("base64")}`);
});

test("a refresh token Zoom has already spent or the user has revoked is reported as revoked", async () => {
  answer({ reason: "Invalid Token!", error: "invalid_grant" }, 400);
  await assert.rejects(refreshTokens(app, "old"), (err: unknown) => err instanceof ZoomError && err.revoked && err.status === 400);
});

test("an answer with no new refresh token is a failure, since the old one is spent", async () => {
  answer({ access_token: "a" });
  await assert.rejects(refreshTokens(app, "old"), ZoomError);
});

test("every meeting scope and the profile scope are needed, named with or without a suffix; an answer that names none is let through", () => {
  const all = "meeting:read:list_past_instances meeting:read:list_past_participants meeting:delete:meeting meeting:write:meeting meeting:read:meeting meeting:update:meeting user:read:user";
  assert.equal(grantedScopes(all), true);
  assert.equal(
    grantedScopes(all.split(" ").map((s) => `${s}:admin`).join(" ")),
    true,
  );
  assert.equal(grantedScopes(all.replace(" user:read:user", "")), false);
  // A connection from before attendance was read has the old create-a-meeting scopes alone.
  assert.equal(grantedScopes("meeting:write:meeting meeting:read:meeting meeting:update:meeting meeting:delete:meeting user:read:user"), false);
  // One from before the sync made its own meetings can read attendance but not make a meeting.
  assert.equal(
    grantedScopes("meeting:read:list_past_instances meeting:read:list_past_participants meeting:delete:meeting user:read:user"),
    false,
  );
  assert.equal(grantedScopes(""), true);
});

test("a meeting is made as a one-off under the connected user, with its facilitators as alternative hosts", async () => {
  const sent: { url: string; method: string; body: unknown }[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(input), method: String(init?.method), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify({ id: 1, join_url: "https://zoom.us/j/1" }), { status: 201, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  const zoom = zoomClient(async () => "token");

  await createMeeting(zoom, {
    topic: "Pre Bootcamp",
    startsAt: new Date("2026-11-10T18:30:00.000Z"),
    minutes: 60,
    timeZone: "America/New_York",
    alternativeHosts: ["a@harness.io", "b@harness.io"],
  });
  assert.equal(sent[0]!.url, "https://api.zoom.us/v2/users/me/meetings");
  assert.deepEqual(sent[0]!.body, {
    topic: "Pre Bootcamp",
    type: 2,
    start_time: "2026-11-10T18:30:00Z",
    duration: 60,
    timezone: "America/New_York",
    settings: { alternative_hosts: "a@harness.io;b@harness.io" },
  });

  await createMeeting(zoom, { topic: "t", startsAt: new Date("2026-11-10T18:30:00Z"), minutes: 30, timeZone: "UTC", alternativeHosts: [] });
  assert.deepEqual((sent[1]!.body as { settings: unknown }).settings, {});

  await setAlternativeHosts(zoom, "123", ["a@harness.io", "c@harness.io"]);
  assert.equal(sent[2]!.method, "PATCH");
  assert.equal(sent[2]!.url, "https://api.zoom.us/v2/meetings/123");
  assert.deepEqual(sent[2]!.body, { settings: { alternative_hosts: "a@harness.io;c@harness.io" } });
});

test("a meeting's alternative hosts are read lowercased, however Zoom separates them", () => {
  assert.deepEqual(alternativeHostsOf({ settings: { alternative_hosts: "A@harness.io; b@harness.io,c@harness.io" } }), [
    "a@harness.io",
    "b@harness.io",
    "c@harness.io",
  ]);
  assert.deepEqual(alternativeHostsOf({}), []);
});
