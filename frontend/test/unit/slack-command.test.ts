/** Slash commands: Slack's signature, and what /val says. */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import { slackSignatureValid, upcomingMessage } from "@/lib/slack-command";

const SECRET = "shh";
const NOW = new Date("2026-11-16T12:00:00Z");
const ts = String(NOW.getTime() / 1000);
const body = "command=%2Fval&user_id=U1";
const sign = (t: string, b: string, secret = SECRET) => `v0=${createHmac("sha256", secret).update(`v0:${t}:${b}`).digest("hex")}`;

describe("slackSignatureValid", () => {
  test("accepts Slack's signature", () => {
    assert.equal(slackSignatureValid(SECRET, body, ts, sign(ts, body), NOW), true);
  });
  test("refuses a wrong secret, a changed body and a missing header", () => {
    assert.equal(slackSignatureValid(SECRET, body, ts, sign(ts, body, "other"), NOW), false);
    assert.equal(slackSignatureValid(SECRET, `${body}x`, ts, sign(ts, body), NOW), false);
    assert.equal(slackSignatureValid(SECRET, body, null, sign(ts, body), NOW), false);
    assert.equal(slackSignatureValid(SECRET, body, ts, null, NOW), false);
  });
  test("refuses everything when no secret is set", () => {
    assert.equal(slackSignatureValid(undefined, body, ts, sign(ts, body), NOW), false);
    assert.equal(slackSignatureValid("", body, ts, sign(ts, body, ""), NOW), false);
  });
  test("refuses a stale timestamp", () => {
    const old = String(NOW.getTime() / 1000 - 600);
    assert.equal(slackSignatureValid(SECRET, body, old, sign(old, body), NOW), false);
  });
});

describe("upcomingMessage", () => {
  test("lists each bootcamp's dates and classes", () => {
    const text = upcomingMessage([
      { id: "a", startDate: "2026-11-09", endDate: "2026-11-12", intDays: null },
      { id: "b", startDate: "2026-12-07", endDate: "2026-12-11", intDays: 2 },
    ]);
    assert.match(text, /Nov 9.{1,3}12, 2026\*: Bootcamp$/m);
    assert.match(text, /Dec 7.{1,3}11, 2026\*: Bootcamp and Intermediate/);
  });
  test("says so when nothing is scheduled", () => {
    assert.equal(upcomingMessage([]), "No sessions are scheduled.");
  });
});
