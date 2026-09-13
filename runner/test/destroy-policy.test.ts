/**
 * The teardown policy: one attempt, then a person — unless the failure is one of
 * the named conditions that clears itself, which gets another tick.
 *
 * Two things are worth pinning here. The text, because for a run that has stopped
 * the stored reason is the *entire* handover: if it does not say what to do then
 * the terminal state is just a tidier dead end than the loop it replaced. And the
 * decision, because it is the narrow exception to a default this project has twice
 * had to correct — once for retrying everything, once for retrying nothing.
 *
 * The other half is `classify.test.ts`, which guards the signature itself, and
 * `destroy-cycle` against a real database, which is where the claim/abandon logic
 * is exercised.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  decideDestroyFailure,
  describeDestroyFailure,
  MAX_DESTROY_ATTEMPTS,
  type DestroyFailureKind,
} from "../src/destroy-policy.js";
import { failure } from "./fixtures/production-failures.js";

/** A destroy failure that is final: a stale lock wants a person, not a tick. */
const FINAL = failure("tofu-state-lock-held").message;
/** The AWS member-account close, which succeeds on the attempt after this one. */
const SELF_CLEARING = failure("aws-org-account-delete-timeout").message;

const KINDS: DestroyFailureKind[] = ["failed", "died"];

describe("describeDestroyFailure", () => {
  test("never promises another attempt", () => {
    // The property that distinguishes this policy from both of its predecessors.
    // The original wrote "destroy failed, will retry" on all 9,482 attempts; the
    // budget wrote "retrying in ~20m". Neither is true any more, and a reader who
    // believes either one will wait instead of acting.
    for (const kind of KINDS) {
      for (const message of [FINAL, SELF_CLEARING, ""]) {
        const text = describeDestroyFailure(kind, message);
        assert.doesNotMatch(text, /will retry|retrying in|attempt \d+ of/i);
      }
    }
  });

  test("says a person has to act, and where", () => {
    for (const kind of KINDS) {
      const text = describeDestroyFailure(kind, FINAL);
      assert.match(text, /Retry teardown/);
      assert.match(text, /costing money/);
    }
  });

  test("a failure carries the provider's own words", () => {
    // Not paraphrased and not summarised: whatever tofu said is the only evidence
    // of the cause, and it now reaches here because `exec` appends the stderr
    // tail to the error rather than throwing a bare "exited with code 1".
    const text = describeDestroyFailure("failed", FINAL);
    assert.ok(text.includes(FINAL));
  });

  test("a death explains itself without a message to quote", () => {
    // The killed-process case has no error text by construction — that is what
    // makes it a death rather than a failure — so the explanation has to stand on
    // its own and name the likely cause.
    const text = describeDestroyFailure("died", "");
    assert.match(text, /killed/);
    assert.match(text, /1800s/);
    assert.match(text, /idempotent/, "must say a retry is safe");
    assert.ok(text.length > 200, "a death with no error text still needs a why");
  });

  test("never tells anyone to edit the state by hand", () => {
    // It used to, for the AWS account close: "clear it with `tofu state rm
    // aws_organizations_account.this`". That advice was built on the belief that
    // the destroy could never succeed, and it was wrong twice over — the destroy
    // succeeds on the next tick, and removing a live account from state is how a
    // real resource gets orphaned and keeps billing. Nothing here should teach
    // that reflex again.
    for (const kind of KINDS) {
      for (const message of [FINAL, SELF_CLEARING, ""]) {
        assert.doesNotMatch(describeDestroyFailure(kind, message), /state rm/);
      }
    }
  });

  test("survives a failure that printed nothing", () => {
    // A non-zero exit with an empty stderr tail. The reason has to read as a fact
    // about the destroy rather than as a sentence that lost its ending, or whoever
    // reads it goes looking for the missing half.
    const text = describeDestroyFailure("failed", "");
    assert.match(text, /printed nothing/);
    assert.doesNotMatch(text, /automatically: *\n/);
    assert.match(text, /Retry teardown/);
  });
});

describe("decideDestroyFailure", () => {
  test("flags an ordinary failure on the first attempt", () => {
    // The default, and it stays the default. A stale state lock is not something
    // another five minutes fixes.
    const decision = decideDestroyFailure("failed", FINAL, 1);
    assert.equal(decision.action, "flag");
  });

  test("retries the AWS account close instead of stopping on it", () => {
    // The regression this whole change exists for: three runs sat in
    // `destroy_failed` with a Harness org, an attendee account and a Google OU
    // still standing, on a condition that resolves in about ninety seconds.
    const decision = decideDestroyFailure("failed", SELF_CLEARING, 1);
    assert.equal(decision.action, "retry");
  });

  test("gives up on a self-clearing failure once the attempts run out", () => {
    // The cap is the difference between rule 3 and the unbounded loop that cost
    // 9,482 executions. At the boundary it must flag, not tick again.
    const last = decideDestroyFailure(
      "failed",
      SELF_CLEARING,
      MAX_DESTROY_ATTEMPTS,
    );
    assert.equal(last.action, "flag");

    const before = decideDestroyFailure(
      "failed",
      SELF_CLEARING,
      MAX_DESTROY_ATTEMPTS - 1,
    );
    assert.equal(before.action, "retry");
  });

  test("never retries a death, whatever the message says", () => {
    // A killed attempt has no error text by construction, so it cannot match a
    // signature — but the guard is explicit rather than incidental, because the
    // death path is precisely the one that looped forever before `claimDestroy`:
    // an attempt that dies the same way every tick never advances a counter, so
    // a cap would not save it.
    for (const message of [SELF_CLEARING, FINAL, ""]) {
      assert.equal(decideDestroyFailure("died", message, 1).action, "flag");
    }
  });

  test("a retry note says it is temporary, and bounds itself", () => {
    // What the page shows for the few minutes the run sits in `destroying` after
    // a failed attempt. It has to read as a pause rather than as the old "destroy
    // failed, will retry" that was written on all 9,482 attempts and meant
    // nothing — so it names the attempt, the cap, and when to start worrying.
    const decision = decideDestroyFailure("failed", SELF_CLEARING, 1);
    assert.equal(decision.action, "retry");
    if (decision.action !== "retry") return;

    assert.match(decision.note, /attempt 2 of 3/);
    assert.match(decision.note, /No action is needed/);
    assert.ok(
      decision.note.includes(SELF_CLEARING),
      "the provider's own words belong here too — this is still a failure",
    );
    assert.doesNotMatch(decision.note, /Retry teardown/);
  });
});
