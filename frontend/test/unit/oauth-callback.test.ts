/** The shared OAuth callback: telling a connection's state from Auth.js's, and checking it against the browser's cookie. */

import { test } from "node:test";
import assert from "node:assert/strict";

import { isConnectState, oauthRedirectUri, purposeOf, stateMatches, startOAuth } from "../../src/lib/oauth-callback";

test("Auth.js's own state, an encrypted token, is never taken for a connection", () => {
  assert.equal(isConnectState("eyJhbGciOiJkaXIiLCJlbmMiOiJBMjU2Q0JDLUhTNTEyIn0..abc.def.ghi"), false);
  assert.equal(isConnectState(null), false);
  assert.equal(isConnectState(""), false);
});

test("a connection's state names its purpose, and only one it knows", () => {
  assert.equal(purposeOf("wo.slack.abc123"), "slack");
  assert.equal(purposeOf("wo.google-meetings.abc123"), "google-meetings");
  assert.equal(purposeOf("wo.nothing.abc123"), null);
  assert.equal(purposeOf("wo.slack"), null, "no nonce");
  assert.equal(purposeOf("wo.slack.a.b"), null, "an extra part");
  assert.equal(purposeOf("slack.abc123"), null, "not ours");
});

test("the state must be the one the browser was sent off with", () => {
  assert.equal(stateMatches("wo.slack.abc", "wo.slack.abc"), true);
  assert.equal(stateMatches("wo.slack.abc", "wo.slack.abd"), false);
  assert.equal(stateMatches("wo.slack.abc", "wo.slack.abcd"), false);
  assert.equal(stateMatches("wo.slack.abc", undefined), false, "no cookie");
  assert.equal(stateMatches(null, "wo.slack.abc"), false);
});

test("every flow returns to Auth.js's sign-in callback, on AUTH_URL when it is set", () => {
  const before = process.env.AUTH_URL;
  try {
    process.env.AUTH_URL = "https://harnessevents.io/";
    assert.equal(oauthRedirectUri(new Request("http://10.0.0.1:8080/x")), "https://harnessevents.io/api/auth/callback/google");
    delete process.env.AUTH_URL;
    assert.equal(oauthRedirectUri(new Request("http://localhost:3000/x")), "http://localhost:3000/api/auth/callback/google");
  } finally {
    if (before === undefined) delete process.env.AUTH_URL;
    else process.env.AUTH_URL = before;
  }
});

test("starting a connection sends its state out and keeps the same one in a cookie for the callback alone", () => {
  let sent = "";
  const res = startOAuth(new Request("https://harnessevents.io/api/cohorts/slack/install"), "slack", (state) => {
    sent = state;
    return `https://slack.com/oauth/v2/authorize?state=${state}`;
  });
  assert.equal(purposeOf(sent), "slack");
  const cookie = res.headers.get("set-cookie") ?? "";
  assert.match(cookie, new RegExp(`^oauth_connect_state=${sent.replace(/\./g, "\\.")};`));
  assert.match(cookie, /Path=\/api\/auth\/callback\/google/);
  assert.match(cookie, /HttpOnly/i);
});
