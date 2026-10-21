/**
 * The time zone helpers: which strings count as a zone (Slack's `tz` and the
 * intake answer are both checked with `isTimeZone`) and how a zone is labelled.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { isTimeZone, timeZoneLabel, timeZoneNames, utcOffsetLabel } from "../../src/lib/timezones";

describe("isTimeZone", () => {
  test("accepts IANA names", () => {
    for (const z of ["America/Chicago", "Europe/London", "Asia/Kolkata", "UTC"]) assert.ok(isTimeZone(z), z);
  });

  test("refuses anything else", () => {
    for (const z of ["", "Mars/Olympus", "Not a zone", "America/", undefined, null, 5]) assert.ok(!isTimeZone(z as never), String(z));
  });
});

describe("labels", () => {
  const winter = new Date("2026-01-15T12:00:00Z");

  test("show the UTC offset at the moment given", () => {
    assert.equal(utcOffsetLabel("America/Chicago", winter), "UTC-06:00");
    assert.equal(timeZoneLabel("America/Chicago", winter), "(UTC-06:00) America/Chicago");
  });

  test("list the zones the runtime knows, each valid", () => {
    const names = timeZoneNames();
    assert.ok(names.includes("America/Chicago"));
    assert.ok(names.every(isTimeZone));
  });
});
