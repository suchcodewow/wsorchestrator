/**
 * The Timed Jobs dispatcher's cron (`lib/cron.ts`): what it accepts, when it
 * says a schedule fell due, across daylight saving, and how it says one in
 * words. The dispatcher starts a job only on what `lastDue` answers, so a
 * wrong answer here is a job run twice, an hour off, or never.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { describeCron, lastDue, nextDue, parseCron, scheduleProblem, type Cron } from "@/lib/cron";

function cron(expr: string): Cron {
  const parsed = parseCron(expr);
  assert.ok(parsed.ok, expr);
  return parsed.cron;
}

const ET = "America/New_York";
const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;

describe("parseCron", () => {
  test("reads values, ranges, steps and lists", () => {
    const c = cron("0,30 9-17/2 1 */3 1-5");
    assert.deepEqual([...c.minutes], [0, 30]);
    assert.deepEqual([...c.hours], [9, 11, 13, 15, 17]);
    assert.deepEqual([...c.days], [1]);
    assert.deepEqual([...c.months], [1, 4, 7, 10]);
    assert.deepEqual([...c.weekdays].sort(), [1, 2, 3, 4, 5]);
    assert.equal(c.anyDay, false);
    assert.equal(c.anyWeekday, false);
  });

  test("takes 7 as Sunday", () => {
    assert.deepEqual([...cron("0 0 * * 7").weekdays], [0]);
  });

  test("refuses the wrong number of fields, names, and values out of range", () => {
    for (const bad of ["* * * *", "* * * * * *", "0 3 * * MON", "60 * * * *", "0 24 * * *", "0 0 0 * *", "*/0 * * * *", "5-1 * * * *"]) {
      assert.equal(parseCron(bad).ok, false, bad);
    }
  });
});

describe("lastDue", () => {
  test("is the latest time due within the catch-up window, or none", () => {
    const daily = cron("0 3 * * *");
    // 3:00 AM EDT is 07:00 UTC.
    assert.equal(iso(lastDue(daily, ET, new Date("2026-10-22T07:00:00Z"))), "2026-10-22T07:00:00.000Z");
    assert.equal(iso(lastDue(daily, ET, new Date("2026-10-22T07:04:59Z"))), "2026-10-22T07:00:00.000Z");
    assert.equal(iso(lastDue(daily, ET, new Date("2026-10-22T07:25:00Z"))), "2026-10-22T07:00:00.000Z");
    assert.equal(lastDue(daily, ET, new Date("2026-10-22T07:30:00Z")), null);
    assert.equal(lastDue(daily, ET, new Date("2026-10-22T06:59:59Z")), null);
  });

  test("follows the zone across daylight saving", () => {
    const daily = cron("0 3 * * *");
    // 3:00 AM EST, after the clocks go back on 1 November, is 08:00 UTC.
    assert.equal(iso(lastDue(daily, ET, new Date("2026-11-02T08:00:00Z"))), "2026-11-02T08:00:00.000Z");
    assert.equal(lastDue(daily, ET, new Date("2026-11-02T07:00:00Z")), null);
  });

  test("gives each call of a burst its own time", () => {
    const burst = cron("0,5,10,15,20,25,30 */2 * * *");
    // 2:10 PM EDT.
    assert.equal(iso(lastDue(burst, ET, new Date("2026-10-22T18:12:00Z"))), "2026-10-22T18:10:00.000Z");
    // 2:40 PM: the burst is over, and 2:30 is still in the window.
    assert.equal(iso(lastDue(burst, ET, new Date("2026-10-22T18:40:00Z"))), "2026-10-22T18:30:00.000Z");
    // 3:10 PM, an odd hour.
    assert.equal(lastDue(burst, ET, new Date("2026-10-22T19:10:00Z")), null);
  });
});

describe("nextDue", () => {
  test("lists the next times after a moment, not at it", () => {
    const daily = cron("0 4 * * *");
    assert.deepEqual(
      nextDue(daily, ET, new Date("2026-10-31T08:00:00Z"), 3).map(iso),
      // 4:00 AM EDT on 31 October has just passed; then EDT, then EST.
      ["2026-11-01T09:00:00.000Z", "2026-11-02T09:00:00.000Z", "2026-11-03T09:00:00.000Z"],
    );
  });

  test("applies cron's either-or rule to a day of the month and a day of the week", () => {
    // The 1st, or any Monday, at noon UTC.
    const either = cron("0 12 1 * 1");
    assert.deepEqual(nextDue(either, "UTC", new Date("2026-10-27T00:00:00Z"), 3).map(iso), [
      "2026-11-01T12:00:00.000Z",
      "2026-11-02T12:00:00.000Z",
      "2026-11-09T12:00:00.000Z",
    ]);
  });
});

describe("scheduleProblem", () => {
  test("passes a schedule the dispatcher can run", () => {
    assert.equal(scheduleProblem("0 3 * * *", ET), null);
    assert.equal(scheduleProblem("*/15 * * * 1-5", "UTC"), null);
  });

  test("names what is wrong", () => {
    assert.match(scheduleProblem("0 3 * * *", "Mars/Olympus") ?? "", /not a time zone/);
    assert.match(scheduleProblem("0 3 * *", ET) ?? "", /five fields/);
    assert.match(scheduleProblem("7 3 * * *", ET) ?? "", /multiple of 5; 7 is not/);
    assert.match(scheduleProblem("0 0 31 2 *", ET) ?? "", /never falls due/);
  });
});

describe("describeCron", () => {
  test("says the usual shapes in words", () => {
    assert.equal(describeCron("*/15 * * * *", ET), "Every 15 minutes");
    assert.equal(describeCron("5 * * * *", ET), "Hourly at :05");
    assert.equal(describeCron("0 3 * * *", ET), "Daily at 3:00 AM Eastern");
    assert.equal(describeCron("30 13 * * 1-5", "America/Los_Angeles"), "Weekdays at 1:30 PM Pacific");
    assert.equal(describeCron("0 0 * * 1", "UTC"), "Mondays at 12:00 AM UTC");
  });

  test("leaves anything else to be shown as its cron", () => {
    assert.equal(describeCron("0,5,10 */2 * * *", ET), null);
    assert.equal(describeCron("0 3 1 * *", ET), null);
  });
});
