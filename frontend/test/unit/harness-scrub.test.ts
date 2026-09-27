/**
 * When this site's secret values are taken back out of a workshop's Harness
 * organization, and how Harness's timestamps are read while deciding.
 *
 * Deployed org secrets hold real credentials for a window and are then
 * overwritten with a placeholder. `scrubWindowDays` is that window, set by
 * HARNESS_CONTENT_SCRUB_DAYS: a bad value must fall back to the default rather
 * than to zero (which scrubs a workshop's credentials the moment they land) or
 * to NaN (which makes the deadline an Invalid Date that never comes, leaving
 * credentials in place forever). `harnessTimestamp` reads a secret's
 * `lastModifiedAt`, which is how a value someone changed in Harness is told
 * apart from the one this site wrote.
 *
 * The functions that read the database or call Harness (`recordDeployedSecret`,
 * `scrubSummaries`, `scrubSecret`, `scrubDeployedSecrets`, `scrubWithToken`)
 * are not exercised here.
 */

import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  EMPTY_SCRUB,
  SCRUB_VALUE,
  harnessTimestamp,
  scrubDeadline,
  scrubWindowDays,
} from "@/lib/harness-scrub";

const DAY = 86_400_000;

let saved: string | undefined;
beforeEach(() => {
  saved = process.env.HARNESS_CONTENT_SCRUB_DAYS;
});
afterEach(() => {
  if (saved === undefined) delete process.env.HARNESS_CONTENT_SCRUB_DAYS;
  else process.env.HARNESS_CONTENT_SCRUB_DAYS = saved;
});

describe("scrubWindowDays", () => {
  test("is seven days when unset or blank", () => {
    delete process.env.HARNESS_CONTENT_SCRUB_DAYS;
    assert.equal(scrubWindowDays(), 7);
    for (const blank of ["", "   ", "\n"]) {
      process.env.HARNESS_CONTENT_SCRUB_DAYS = blank;
      assert.equal(scrubWindowDays(), 7, JSON.stringify(blank));
    }
  });

  test("uses a configured number of days, including fractions", () => {
    process.env.HARNESS_CONTENT_SCRUB_DAYS = "14";
    assert.equal(scrubWindowDays(), 14);
    process.env.HARNESS_CONTENT_SCRUB_DAYS = " 3 ";
    assert.equal(scrubWindowDays(), 3);
    process.env.HARNESS_CONTENT_SCRUB_DAYS = "0.5";
    assert.equal(scrubWindowDays(), 0.5);
  });

  test("accepts zero, meaning scrub at the next opportunity", () => {
    process.env.HARNESS_CONTENT_SCRUB_DAYS = "0";
    assert.equal(scrubWindowDays(), 0);
  });

  test("falls back to seven for a negative, non-numeric or infinite value", () => {
    for (const bad of ["-1", "-0.5", "seven", "7d", "NaN", "Infinity", "-Infinity", "1,5"]) {
      process.env.HARNESS_CONTENT_SCRUB_DAYS = bad;
      assert.equal(scrubWindowDays(), 7, bad);
    }
  });

  test("is read on every call, not once at import", () => {
    process.env.HARNESS_CONTENT_SCRUB_DAYS = "1";
    assert.equal(scrubWindowDays(), 1);
    process.env.HARNESS_CONTENT_SCRUB_DAYS = "2";
    assert.equal(scrubWindowDays(), 2);
  });
});

describe("scrubDeadline", () => {
  const written = new Date("2026-09-01T12:00:00.000Z");

  test("is the window after the given time", () => {
    delete process.env.HARNESS_CONTENT_SCRUB_DAYS;
    assert.equal(scrubDeadline(written).toISOString(), "2026-09-08T12:00:00.000Z");
    process.env.HARNESS_CONTENT_SCRUB_DAYS = "0.5";
    assert.equal(scrubDeadline(written).toISOString(), "2026-09-02T00:00:00.000Z");
  });

  test("is the given time itself for a zero-day window", () => {
    process.env.HARNESS_CONTENT_SCRUB_DAYS = "0";
    assert.equal(scrubDeadline(written).getTime(), written.getTime());
  });

  test("is always a real date, even when the setting is garbage", () => {
    process.env.HARNESS_CONTENT_SCRUB_DAYS = "soon";
    const deadline = scrubDeadline(written);
    assert.ok(Number.isFinite(deadline.getTime()));
    assert.equal(deadline.getTime() - written.getTime(), 7 * DAY);
  });

  test("defaults to counting from now", () => {
    delete process.env.HARNESS_CONTENT_SCRUB_DAYS;
    const before = Date.now();
    const deadline = scrubDeadline().getTime();
    const after = Date.now();
    assert.ok(deadline >= before + 7 * DAY && deadline <= after + 7 * DAY);
  });

  test("does not modify the date it was given", () => {
    const from = new Date(written);
    scrubDeadline(from);
    assert.equal(from.getTime(), written.getTime());
  });
});

describe("harnessTimestamp", () => {
  test("reads Harness's epoch milliseconds", () => {
    assert.equal(harnessTimestamp(1_756_728_000_000)?.toISOString(), "2025-09-01T12:00:00.000Z");
    assert.equal(harnessTimestamp(1)?.getTime(), 1);
  });

  test("is null for zero, which Harness sends for never", () => {
    assert.equal(harnessTimestamp(0), null);
  });

  test("is null for anything that is not a positive finite number", () => {
    for (const bad of [-1, NaN, Infinity, -Infinity, "1756728000000", null, undefined, {}, new Date(), true]) {
      assert.equal(harnessTimestamp(bad), null, String(bad));
    }
  });
});

describe("constants", () => {
  test("the placeholder is the documented value", () => {
    // The scrubbed secret's description tells people it now holds this value.
    assert.equal(SCRUB_VALUE, "123");
  });

  test("an empty summary counts nothing and lists nothing", () => {
    assert.deepEqual(EMPTY_SCRUB, {
      pending: 0,
      scrubbed: 0,
      skipped: 0,
      failed: 0,
      dueAt: null,
      scrubbedAt: null,
      orgs: [],
      problems: [],
    });
  });
});
