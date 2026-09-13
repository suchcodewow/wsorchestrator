/**
 * The budget half of the AWS retry decision, and the thing that decision is
 * also used for: whether an attempt's stderr was a failure.
 *
 * `classify.test.ts` pins what a message *means*. This pins what is done about
 * it on the Nth attempt — including that a message the runner is about to
 * retry is not treated as a fault, which is the whole reason a healthy AWS run
 * used to fill its log with red `OptInRequired` blocks.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  AWS_RETRY_DELAYS_MS,
  awsAttemptOutcome,
  type AwsRetryKind,
} from "../src/classify.js";
import { expecting, failure } from "./fixtures/production-failures.js";

const fresh = (): Record<AwsRetryKind, number> => ({
  contention: 0,
  warmup: 0,
});

describe("awsAttemptOutcome", () => {
  test("retries the warm-up every AWS run actually hits", () => {
    // The pair from run fe1c540a (2026-09-12), which recovered on the first
    // retry and built its cluster — the run that prompted this.
    const stderr = [
      failure("aws-ec2-optin-describe-azs").message,
      failure("aws-ec2-optin-createvpc").message,
    ].join("\n");

    assert.deepEqual(awsAttemptOutcome(stderr, fresh()), {
      action: "retry",
      kind: "warmup",
      delayMs: 60_000,
    });
  });

  test("spends each reason's budget in order, then gives up", () => {
    const stderr = failure("aws-ec2-optin-createvpc").message;
    const spent = fresh();

    for (const delayMs of AWS_RETRY_DELAYS_MS.warmup) {
      assert.deepEqual(awsAttemptOutcome(stderr, spent), {
        action: "retry",
        kind: "warmup",
        delayMs,
      });
      spent.warmup++;
    }

    assert.deepEqual(awsAttemptOutcome(stderr, spent), { action: "fail" });
  });

  test("keeps a budget per reason, so one does not consume the other", () => {
    // A run that spent every warm-up attempt can still wait out another run
    // holding Organizations, and vice versa.
    const spent: Record<AwsRetryKind, number> = {
      warmup: AWS_RETRY_DELAYS_MS.warmup.length,
      contention: 0,
    };

    assert.deepEqual(
      awsAttemptOutcome(failure("aws-org-concurrent-modification").message, spent),
      { action: "retry", kind: "contention", delayMs: 60_000 },
    );
  });

  test("fails on a message no retry can fix, whatever the budget", () => {
    for (const f of expecting("fail")) {
      assert.deepEqual(
        awsAttemptOutcome(f.message, fresh()),
        { action: "fail" },
        `${f.id} should not be retried`,
      );
    }
  });
});
