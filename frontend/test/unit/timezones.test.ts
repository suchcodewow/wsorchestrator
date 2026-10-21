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

  test("lists one zone per offset, in offset order rather than name order", () => {
    assert.equal(new Set(offsets).size, offsets.length);
    assert.deepEqual(offsets, [...offsets].sort((a, b) => a - b));
    assert.ok(choices.length < timeZoneNames().length / 4);
  });

  test("stands for an offset with a well-known zone, labelled with that offset", () => {
    const chicago = choices.find((c) => utcOffsetMinutes(c.value, november) === -360)!;
    assert.equal(chicago.value, "America/Chicago");
    assert.equal(chicago.label, "(UTC-06:00) America/Chicago");
  });

  test("stands for its own offset with the person's zone, so choosing nothing changes nothing", () => {
    const mine = timeZoneChoices(november, "America/Regina").find((c) => c.value === "America/Regina");
    assert.ok(mine);
    assert.equal(timeZoneChoices(november, "America/Chicago").length, choices.length);
  });

  test("every value it offers is a zone the intake answer accepts", () => {
    assert.ok(choices.every((c) => isTimeZone(c.value)));
  });
});
