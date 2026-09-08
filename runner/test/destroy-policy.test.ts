/**
 * The teardown retry budget.
 *
 * These tests exist because the bug they guard against was invisible in
 * production for a month: the reaper caught every destroy failure and left the
 * run in `destroying`, so 572 doomed attempts and a healthy first retry produced
 * exactly the same observable state. The properties asserted here — the ladder
 * grows, the budget ends, and giving up says why — are the only difference
 * between the two, so each one is pinned rather than left to the reading of
 * `nextDestroyStep`.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  DESTROY_BACKOFF_BASE_SECONDS,
  DESTROY_BACKOFF_MAX_SECONDS,
  MAX_DESTROY_ATTEMPTS,
  describeDestroyDecision,
  destroyBackoffSeconds,
  nextDestroyStep,
} from "../src/destroy-policy.js";
import { failure } from "./fixtures/production-failures.js";

/** A destroy failure with no verdict of its own: retryable until the budget ends. */
const TRANSIENT = failure("tofu-state-lock-held").message;
/** The one that cannot ever succeed. */
const TERMINAL = failure("aws-org-account-delete-timeout").message;

describe("destroyBackoffSeconds", () => {
  test("waits one reaper tick after the first failure", () => {
    // Shorter than a tick is unhonourable: the run is not looked at again until
    // the cron fires, so a 30s delay would just mean "next tick" while reading
    // as something faster.
    assert.equal(destroyBackoffSeconds(1), DESTROY_BACKOFF_BASE_SECONDS);
  });

  test("doubles each time", () => {
    assert.deepEqual(
      [1, 2, 3, 4, 5, 6, 7].map(destroyBackoffSeconds),
      [300, 600, 1200, 2400, 4800, 9600, 19200],
    );
  });

  test("spends about half a day before giving up", () => {
    // The number that makes the cap a judgement rather than an arbitrary 8: the
    // whole budget has to outlast anything eventually-consistent and still
    // surface a wedged teardown the same day.
    let total = 0;
    for (let a = 1; a < MAX_DESTROY_ATTEMPTS; a++) {
      total += destroyBackoffSeconds(a);
    }
    const hours = total / 3600;
    assert.ok(hours > 8 && hours < 12, `budget spans ${hours.toFixed(1)}h`);
  });

  test("never exceeds the ceiling, however large the counter", () => {
    // 2 ** 1024 is Infinity, and an Infinity delay becomes a timestamp Postgres
    // rejects — a throw inside the error handler, which would put the reaper
    // back to looping without recording anything.
    for (const attempts of [8, 20, 100, 1_000, 1e9]) {
      const seconds = destroyBackoffSeconds(attempts);
      assert.ok(Number.isFinite(seconds), `${attempts} gave ${seconds}`);
      assert.ok(seconds <= DESTROY_BACKOFF_MAX_SECONDS);
    }
  });

  test("is monotonic, so a later attempt never waits less", () => {
    let previous = 0;
    for (let a = 1; a <= 40; a++) {
      const seconds = destroyBackoffSeconds(a);
      assert.ok(seconds >= previous, `attempt ${a} went backwards`);
      previous = seconds;
    }
  });
});

describe("nextDestroyStep", () => {
  test("retries a transient failure with a growing delay", () => {
    assert.deepEqual(nextDestroyStep(0, TRANSIENT), {
      kind: "retry",
      attempts: 1,
      delaySeconds: 300,
    });
    assert.deepEqual(nextDestroyStep(1, TRANSIENT), {
      kind: "retry",
      attempts: 2,
      delaySeconds: 600,
    });
  });

  test("gives up when the budget runs out", () => {
    assert.deepEqual(nextDestroyStep(MAX_DESTROY_ATTEMPTS - 1, TRANSIENT), {
      kind: "give-up",
      attempts: MAX_DESTROY_ATTEMPTS,
      reason: "exhausted",
    });
  });

  test("terminates the loop that ran 572 times", () => {
    // The regression, stated directly: this exact string, on a five-minute tick,
    // for two days. Every prior attempt count must also stop, because a counter
    // that somehow got past the cap must not fall through to `retry`.
    for (const prior of [0, 1, 7, 8, 571, 1000]) {
      const decision = nextDestroyStep(prior, TRANSIENT);
      assert.equal(
        decision.kind === "retry" && prior >= MAX_DESTROY_ATTEMPTS - 1,
        false,
        `prior=${prior} kept retrying past the cap`,
      );
    }
    assert.deepEqual(nextDestroyStep(571, TRANSIENT), {
      kind: "give-up",
      attempts: 572,
      reason: "exhausted",
    });
  });

  test("stops a permanent failure on the first attempt", () => {
    assert.deepEqual(nextDestroyStep(0, TERMINAL), {
      kind: "give-up",
      attempts: 1,
      reason: "permanent",
    });
  });

  test("reports 'permanent' rather than 'exhausted' when both apply", () => {
    // Ordering, not cosmetics: the two branches produce different operator
    // instructions, and "it did not work eight times" sends someone looking for
    // a flake in a failure that is impossible by construction.
    const decision = nextDestroyStep(MAX_DESTROY_ATTEMPTS + 5, TERMINAL);
    assert.equal(decision.kind, "give-up");
    assert.equal(decision.kind === "give-up" && decision.reason, "permanent");
  });

  test("counts the attempt that just failed", () => {
    // `priorAttempts` is the stored counter as read at the start of the attempt,
    // so the decision has to report prior + 1. Off by one here and the log says
    // "attempt 7 of 8" on the run's last try.
    assert.equal(nextDestroyStep(6, TRANSIENT).attempts, 7);
  });
});

describe("describeDestroyDecision", () => {
  test("a retry says which attempt this was and when the next one is", () => {
    const decision = nextDestroyStep(2, TRANSIENT);
    const text = describeDestroyDecision(decision, TRANSIENT);
    assert.match(text, /attempt 3 of 8/);
    assert.match(text, /~20m/);
    assert.ok(text.includes(TRANSIENT), "must carry the provider's own message");
  });

  test("giving up on a permanent failure hands over the fix", () => {
    // This string is the whole of the handover — it becomes the run's `error`
    // and is what someone reads on the page. If it does not name the command,
    // the terminal state is just a nicer-looking dead end than the old loop.
    const text = describeDestroyDecision(nextDestroyStep(0, TERMINAL), TERMINAL);
    assert.match(text, /will not be retried/);
    assert.match(text, /tofu state rm aws_organizations_account\.this/);
    assert.match(text, /no longer billing/);
    assert.ok(text.includes(TERMINAL));
  });

  test("an exhausted budget says nothing more will happen, and why that matters", () => {
    const text = describeDestroyDecision(
      nextDestroyStep(MAX_DESTROY_ATTEMPTS - 1, TRANSIENT),
      TRANSIENT,
    );
    assert.match(text, /stopped retrying/);
    assert.match(text, /costing money/);
    assert.ok(text.includes(TRANSIENT));
  });

  test("never claims a retry is coming when it is not", () => {
    // The old log line said "will retry" every single time, which is why the
    // loop was unreadable. A give-up must not contain that promise.
    for (const prior of [0, MAX_DESTROY_ATTEMPTS - 1]) {
      for (const message of [TRANSIENT, TERMINAL]) {
        const decision = nextDestroyStep(prior, message);
        const text = describeDestroyDecision(decision, message);
        if (decision.kind === "give-up") {
          assert.ok(
            !/retrying in/.test(text),
            `give-up (${decision.reason}) promised another attempt`,
          );
        }
      }
    }
  });
});
