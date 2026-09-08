/**
 * The teardown policy: one attempt, then a person.
 *
 * There is no arithmetic left to test here — the budget and the backoff ladder are
 * gone, which is the point. What is worth pinning is the text, because with no
 * retry the stored reason is the *entire* handover: it is what someone reads on a
 * run that has stopped, and if it does not say what to do then the terminal state
 * is just a tidier dead end than the loop it replaced.
 *
 * The other half is `classify.test.ts`, which guards the one signature that earns
 * extra guidance, and `destroy-cycle` against a real database, which is where the
 * claim/abandon logic is exercised.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  describeDestroyFailure,
  type DestroyFailureKind,
} from "../src/destroy-policy.js";
import { failure } from "./fixtures/production-failures.js";

/** A destroy failure with no special guidance attached. */
const TRANSIENT = failure("tofu-state-lock-held").message;
/** The AWS member-account close, which cannot succeed however often it is tried. */
const TERMINAL = failure("aws-org-account-delete-timeout").message;

const KINDS: DestroyFailureKind[] = ["failed", "died"];

describe("describeDestroyFailure", () => {
  test("never promises another attempt", () => {
    // The property that distinguishes this policy from both of its predecessors.
    // The original wrote "destroy failed, will retry" on all 9,482 attempts; the
    // budget wrote "retrying in ~20m". Neither is true any more, and a reader who
    // believes either one will wait instead of acting.
    for (const kind of KINDS) {
      for (const message of [TRANSIENT, TERMINAL, ""]) {
        const text = describeDestroyFailure(kind, message);
        assert.doesNotMatch(text, /will retry|retrying in|attempt \d+ of/i);
      }
    }
  });

  test("says a person has to act, and where", () => {
    for (const kind of KINDS) {
      const text = describeDestroyFailure(kind, TRANSIENT);
      assert.match(text, /Retry teardown/);
      assert.match(text, /costing money/);
    }
  });

  test("a failure carries the provider's own words", () => {
    // Not paraphrased and not summarised: whatever tofu said is the only evidence
    // of the cause, and it now reaches here because `exec` appends the stderr
    // tail to the error rather than throwing a bare "exited with code 1".
    const text = describeDestroyFailure("failed", TRANSIENT);
    assert.ok(text.includes(TRANSIENT));
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

  test("adds the state-removal instruction only for the AWS account close", () => {
    // The one failure worth extra words, and the guard against handing them out
    // wrongly: telling someone to `tofu state rm` a resource that was going to
    // destroy cleanly is how a real cloud resource gets orphaned and keeps
    // billing.
    const terminal = describeDestroyFailure("failed", TERMINAL);
    assert.match(terminal, /tofu state rm aws_organizations_account\.this/);
    assert.match(terminal, /no longer billing/);

    assert.doesNotMatch(describeDestroyFailure("failed", TRANSIENT), /state rm/);
    assert.doesNotMatch(describeDestroyFailure("died", ""), /state rm/);
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
