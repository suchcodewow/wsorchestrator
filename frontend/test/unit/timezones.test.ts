/**
 * The time zone helpers: which strings count as a zone (Slack's `tz` and the
 * intake answer are both checked with `isTimeZone`) and how a zone is labelled.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  isTimeZone,
  timeZoneChoices,
  timeZoneLabel,
  timeZoneNames,
  utcOffsetLabel,
  utcOffsetMinutes,
} from "../../src/lib/timezones";

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

describe("timeZoneChoices", () => {
  const november = new Date("2026-11-17T12:00:00Z");
  const choices = timeZoneChoices(november);
  const offsets = choices.map((c) => utcOffsetMinutes(c.value, november));

  test("reads offsets in minutes, half hours included", () => {
    assert.equal(utcOffsetMinutes("America/Chicago", november), -360);
    assert.equal(utcOffsetMinutes("Asia/Kolkata", november), 330);
    assert.equal(utcOffsetMinutes("UTC", november), 0);
  });

  test("lists every zone, in offset order and then name order", () => {
    assert.equal(choices.length, timeZoneNames().length);
    assert.deepEqual(offsets, [...offsets].sort((a, b) => a - b));
  });

  test("keeps zones that share an offset today apart, so a no-DST zone stays choosable", () => {
    const summer = new Date("2026-07-15T12:00:00Z");
    const values = timeZoneChoices(summer).map((c) => c.value);
    assert.ok(values.includes("America/Phoenix"));
    assert.ok(values.includes("America/Los_Angeles"));
    assert.equal(utcOffsetMinutes("America/Phoenix", summer), utcOffsetMinutes("America/Los_Angeles", summer));
  });

  test("labels a zone with its offset", () => {
    const chicago = choices.find((c) => c.value === "America/Chicago")!;
    assert.equal(chicago.label, "(UTC-06:00) America/Chicago");
  });

  test("lists the person's zone even when the runtime knows it only as an alias", () => {
    const alias = timeZoneChoices(november, "Asia/Calcutta").find((c) => c.value === "Asia/Calcutta");
    assert.ok(alias);
  });

  test("every value it offers is a zone the intake answer accepts", () => {
    assert.ok(choices.every((c) => isTimeZone(c.value)));
  });
});
