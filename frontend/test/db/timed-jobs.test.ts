/**
 * The Timed Jobs dispatcher (`dispatchTimedJobs`) against the database: it
 * starts a job once for each time its schedule falls due, however many ticks
 * come in for that time, never a time missed by more than the catch-up
 * window, and on the schedule set on the tab once there is one.
 *
 * Every dispatched job is switched off here, so a job that falls due is
 * recorded as skipped and calls nothing outside. The rows this suite changes
 * are the jobs' own, so they are saved before and put back after.
 */

import "../support/test-env";

import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { inArray } from "drizzle-orm";

import { db } from "@/db";
import { timedJobs } from "@/db/schema";
import { dispatchTimedJobs, listTimedJobs, setTimedJobSchedule } from "@/lib/timed-jobs";
import { TIMED_JOBS } from "@/lib/timed-jobs-registry";
import { PERSONAS } from "../support/access";
import { assertScratchDatabase } from "../support/db";
import { testScope } from "../support/seed";

const scope = testScope("timedjobs");
const KEYS = TIMED_JOBS.map((job) => job.key);
const CTX = { appUrl: "http://localhost", deadline: Date.now() + 60_000 };
let saved: (typeof timedJobs.$inferSelect)[] = [];
let actor = "";

before(async () => {
  await assertScratchDatabase();
  saved = await db.select().from(timedJobs).where(inArray(timedJobs.key, KEYS));
  await scope.setUp();
  actor = (await scope.createUser("admin", PERSONAS.platform)).id;
});

after(async () => {
  await db.delete(timedJobs).where(inArray(timedJobs.key, KEYS));
  if (saved.length > 0) await db.insert(timedJobs).values(saved);
  await scope.tearDown();
});

beforeEach(async () => {
  await db.delete(timedJobs).where(inArray(timedJobs.key, KEYS));
  await db.insert(timedJobs).values(KEYS.map((key) => ({ key, enabled: false })));
});

describe("dispatchTimedJobs", () => {
  test("starts a job once for the time it falls due, however many ticks come", async () => {
    // 3:00 AM Eastern, the HiBob sync's default; nothing else is due.
    const first = await dispatchTimedJobs(new Date("2026-10-22T07:00:30Z"), CTX);
    assert.deepEqual(first, [{ key: "hibob-sync", status: 200, body: { skipped: "off" } }]);

    // The same tick again, as a retry would, and the next one along.
    assert.deepEqual(await dispatchTimedJobs(new Date("2026-10-22T07:00:30Z"), CTX), []);
    assert.deepEqual(await dispatchTimedJobs(new Date("2026-10-22T07:05:00Z"), CTX), []);

    const [row] = await db.select().from(timedJobs).where(inArray(timedJobs.key, ["hibob-sync"]));
    assert.equal(row?.scheduledFor?.toISOString(), "2026-10-22T07:00:00.000Z");
    assert.equal(row?.lastStatus, "skipped");
  });

  test("catches up on a time missed by a few minutes, but not one long past", async () => {
    assert.deepEqual(
      (await dispatchTimedJobs(new Date("2026-10-22T07:20:00Z"), CTX)).map((r) => r.key),
      ["hibob-sync"],
    );
    await db.delete(timedJobs).where(inArray(timedJobs.key, ["hibob-sync"]));
    assert.deepEqual(await dispatchTimedJobs(new Date("2026-10-22T07:35:00Z"), CTX), []);
  });

  test("runs on the schedule set on the tab, from the time it was set", async () => {
    assert.deepEqual(await setTimedJobSchedule(actor, "google-meetings-sync", { cron: "*/5 * * * *", timeZone: "UTC" }), { ok: true });

    // The time it was set in has already passed, so it is not run late.
    const now = new Date();
    assert.deepEqual((await dispatchTimedJobs(now, CTX)).filter((r) => r.key === "google-meetings-sync"), []);
    const later = new Date(now.getTime() + 5 * 60_000);
    assert.deepEqual(
      (await dispatchTimedJobs(later, CTX)).filter((r) => r.key === "google-meetings-sync").map((r) => r.status),
      [200],
    );

    const job = (await listTimedJobs()).find((j) => j.key === "google-meetings-sync")!;
    assert.equal(job.custom, true);
    assert.equal(job.schedule, "Every 5 minutes");
    assert.equal(job.cron, "*/5 * * * *");
    assert.equal(job.defaultCron, "0 4 * * *");
  });
});

describe("setTimedJobSchedule", () => {
  test("stores the default as no schedule, so the job follows it", async () => {
    await setTimedJobSchedule(actor, "hibob-sync", { cron: "0 6 * * 1-5", timeZone: "America/Chicago" });
    assert.equal((await listTimedJobs()).find((j) => j.key === "hibob-sync")?.schedule, "Weekdays at 6:00 AM Central");

    await setTimedJobSchedule(actor, "hibob-sync", { cron: " 0  3 * * * ", timeZone: "America/New_York" });
    const [row] = await db.select().from(timedJobs).where(inArray(timedJobs.key, ["hibob-sync"]));
    assert.equal(row?.cron, null);
    assert.equal(row?.timeZone, null);
    assert.equal((await listTimedJobs()).find((j) => j.key === "hibob-sync")?.custom, false);
  });

  test("refuses a schedule it cannot run, one Terraform sets, and a job that is not one", async () => {
    assert.deepEqual(await setTimedJobSchedule(actor, "hibob-sync", { cron: "7 3 * * *", timeZone: "UTC" }), {
      ok: false,
      error: "invalid_schedule",
      detail: "Jobs are started every 5 minutes, so each minute must be a multiple of 5; 7 is not",
    });
    assert.deepEqual(await setTimedJobSchedule(actor, "reaper", null), { ok: false, error: "fixed_schedule" });
    assert.deepEqual(await setTimedJobSchedule(actor, "nope", null), { ok: false, error: "not_found" });
  });
});
