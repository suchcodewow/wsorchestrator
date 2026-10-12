/**
 * The Timed Jobs registry against `infra/admin/scheduler.tf`. The tab shows
 * each schedule from the registry, so a schedule changed in Terraform alone
 * would leave the tab telling people the wrong thing.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { TIMED_JOBS, timedJobDef } from "@/lib/timed-jobs-registry";

const TERRAFORM = readFileSync(join(process.cwd(), "..", "infra", "admin", "scheduler.tf"), "utf8");
const VARIABLES = readFileSync(join(process.cwd(), "..", "infra", "admin", "variables.tf"), "utf8");

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

describe("timed jobs registry", () => {
  test("keys are unique", () => {
    assert.equal(new Set(TIMED_JOBS.map((job) => job.key)).size, TIMED_JOBS.length);
  });

  test("every job's cron is the one scheduler.tf runs it on", () => {
    for (const job of TIMED_JOBS) {
      assert.equal(scheduleOf(job.resource), job.cron, job.key);
    }
  });

  test("a key looks up its job, and an unknown one nothing", () => {
    assert.equal(timedJobDef("reaper")?.name, "Reaper");
    assert.equal(timedJobDef("nope"), undefined);
  });
});
