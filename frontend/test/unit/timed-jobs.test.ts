/**
 * The Timed Jobs registry against `infra/admin/scheduler.tf`, and the
 * dispatched jobs against the buttons they stand in for.
 *
 * The reaper and the scheduler run on the Cloud Scheduler job Terraform
 * gives each, and the tab shows their schedule from the registry, so one
 * changed in Terraform alone would leave the tab telling people the wrong
 * thing. The app's own jobs are started by the dispatcher's tick, which must
 * exist, and on a default it can run.
 *
 * Each dispatched job must also keep to the rules its Sync Now button does:
 * a dry run while its sync is not live, and the test group in place of the
 * cohort while the group is on. Both are decided inside the sync itself, so
 * a scheduled run keeps to them only by calling the same function with no
 * override; the last test holds `lib/timed-job-runs.ts` to that.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { scheduleProblem } from "@/lib/cron";
import { TICK_RESOURCE, TIMED_JOBS, timedJobDef } from "@/lib/timed-jobs-registry";

const TERRAFORM = readFileSync(join(process.cwd(), "..", "infra", "admin", "scheduler.tf"), "utf8");
const VARIABLES = readFileSync(join(process.cwd(), "..", "infra", "admin", "variables.tf"), "utf8");
const RUNS = readFileSync(join(process.cwd(), "src", "lib", "timed-job-runs.ts"), "utf8");

/** The `schedule` of the Cloud Scheduler job named `resource`, literal or the default of its variable. */
function scheduleOf(resource: string): string | undefined {
  const block = new RegExp(`name\\s*=\\s*"${resource}"[\\s\\S]*?schedule\\s*=\\s*([^\\n]+)`).exec(TERRAFORM)?.[1]?.trim();
  if (!block) return undefined;
  const literal = /^"([^"]+)"/.exec(block)?.[1];
  if (literal) return literal;
  const variable = /^var\.(\w+)/.exec(block)?.[1];
  if (!variable) return undefined;
  return new RegExp(`variable\\s+"${variable}"[\\s\\S]*?default\\s*=\\s*"([^"]+)"`).exec(VARIABLES)?.[1];
}

/** The source of one job's entry in `TIMED_JOB_RUNS`, up to the next entry. */
function runOf(key: string): string {
  const start = RUNS.indexOf(`"${key}": {`);
  assert.notEqual(start, -1, `no run for ${key} in lib/timed-job-runs.ts`);
  const next = RUNS.slice(start + 1).search(/\n  "[\w-]+": \{/);
  return next === -1 ? RUNS.slice(start) : RUNS.slice(start, start + 1 + next);
}

describe("timed jobs registry", () => {
  test("keys are unique", () => {
    assert.equal(new Set(TIMED_JOBS.map((job) => job.key)).size, TIMED_JOBS.length);
  });

  test("a Cloud Scheduler job's cron is the one scheduler.tf runs it on", () => {
    for (const job of TIMED_JOBS.filter((job) => job.via === "cloud-scheduler")) {
      assert.equal(scheduleOf(job.resource), job.cron, job.key);
    }
  });

  test("the dispatcher's tick runs every five minutes", () => {
    assert.equal(scheduleOf(TICK_RESOURCE), "*/5 * * * *");
  });

  test("a dispatched job's default is one the dispatcher can run", () => {
    for (const job of TIMED_JOBS.filter((job) => job.via === "dispatcher")) {
      assert.equal(job.resource, TICK_RESOURCE, job.key);
      assert.equal(scheduleProblem(job.cron, job.timeZone), null, job.key);
    }
  });

  test("a key looks up its job, and an unknown one nothing", () => {
    assert.equal(timedJobDef("reaper")?.name, "Reaper");
    assert.equal(timedJobDef("nope"), undefined);
  });
});

describe("dispatched jobs", () => {
  test("every one has a run, and every run a job", () => {
    const dispatched = TIMED_JOBS.filter((job) => job.via === "dispatcher").map((job) => job.key).sort();
    const runs = [...RUNS.matchAll(/\n  "([\w-]+)": \{/g)].map((m) => m[1]).sort();
    assert.deepEqual(runs, dispatched);
  });

  test("each calls its button's sync with no dry-run or test-group override", () => {
    const calls: Record<string, RegExp[]> = {
      "hibob-sync": [/syncHibobEmployees\("schedule", null\)/, /runSlackSync\("schedule", null, deadline, \{ scope: "all", appUrl \}\)/],
      "google-meetings-sync": [/runMeetingSync\("schedule", null, deadline\)/],
      "canary-wire-pull": [/scheduledStep\(\)/],
    };
    for (const [key, expected] of Object.entries(calls)) {
      const run = runOf(key);
      for (const call of expected) assert.match(run, call, key);
      // preview forces a dry run, and anything naming the test group or live
      // would be the scheduled run deciding for itself what the sync decides.
      assert.doesNotMatch(run, /\b(preview|dryRun|live|testGroup|cohort)\s*:/, key);
    }
  });
});
