/**
 * Every provider message a workshop has died on, run back through the
 * classifiers that should have handled it.
 *
 * The corpus in `fixtures/production-failures.ts` carries the expected verdict
 * with each string, so this file is mostly a loop. The value is not in the
 * assertions being clever — it is that a real failure from August cannot recur
 * in October without turning this suite red first.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  AWS_ACCOUNT_WARMUP_SIGNATURES,
  awsRetryKind,
  isGkeCapacityError,
} from "../src/classify.js";
import {
  PRODUCTION_FAILURES,
  expecting,
  failure,
} from "./fixtures/production-failures.js";

describe("awsRetryKind", () => {
  for (const f of expecting("retry-warmup")) {
    test(`waits out ${f.id} (${f.run}, ${f.date})`, () => {
      assert.equal(
        awsRetryKind(f.message),
        "warmup",
        `should be treated as a warm-up wait — ${f.because}`,
      );
    });
  }

  for (const f of expecting("retry-contention")) {
    test(`waits out ${f.id} (${f.run}, ${f.date})`, () => {
      assert.equal(
        awsRetryKind(f.message),
        "contention",
        `should be treated as contention on the management account — ${f.because}`,
      );
    });
  }

  for (const f of expecting("fail")) {
    test(`does not retry ${f.id} (${f.run}, ${f.date})`, () => {
      assert.equal(
        awsRetryKind(f.message),
        null,
        `must stay a real failure — ${f.because}`,
      );
    });
  }

  test("classifies whatever case the provider happens to use", () => {
    // Providers are not consistent about casing between services, and every
    // signature is stored lowercase, so the folding is load-bearing rather than
    // cosmetic.
    const { message } = failure("aws-iam-invalid-token-getuser");
    assert.equal(awsRetryKind(message.toUpperCase()), "warmup");
    assert.equal(awsRetryKind(message.toLowerCase()), "warmup");
  });

  test("an empty capture is not a reason to retry", () => {
    // `applyAwsWithRetry` classifies the stderr it captured. A crash that
    // printed nothing must not read as a retryable condition, or the apply
    // loops on an error nobody can see.
    assert.equal(awsRetryKind(""), null);
  });

  test("a bare AccessDenied is not warm-up", () => {
    // Pinned as its own case because it is the tempting wrong fix: it looks
    // exactly like the InvalidClientTokenId failures beside it in the corpus,
    // and adding it would turn a missing IAM policy into an eleven-minute wait
    // followed by a timeout that names the wrong cause.
    assert.ok(
      !AWS_ACCOUNT_WARMUP_SIGNATURES.some((s) => s.includes("accessdenied")),
      "see fixture aws-iam-access-denied-orchestrator",
    );
    assert.equal(
      awsRetryKind(failure("aws-iam-access-denied-orchestrator").message),
      null,
    );
  });
});

describe("isGkeCapacityError", () => {
  for (const f of expecting("retry-other-zone")) {
    test(`moves zone for ${f.id}`, () => {
      assert.equal(isGkeCapacityError(f.message), true, f.because);
    });
  }

  test("does not claim failures that belong to another cloud", () => {
    // The zone-hopping path re-applies somewhere else. Sending an AWS or
    // Harness failure down it would rebuild in a second zone and fail again
    // identically, doubling the wait before the run reports anything useful.
    for (const f of PRODUCTION_FAILURES) {
      if (f.expect === "retry-other-zone") continue;
      assert.equal(
        isGkeCapacityError(f.message),
        false,
        `${f.id} must not be read as a GKE stockout — ${f.because}`,
      );
    }
  });

  test("an empty capture is not a stockout", () => {
    assert.equal(isGkeCapacityError(""), false);
  });
});

describe("the corpus itself", () => {
  test("has unique ids", () => {
    const ids = PRODUCTION_FAILURES.map((f) => f.id);
    assert.deepEqual(
      ids.filter((id, i) => ids.indexOf(id) !== i),
      [],
      "duplicate fixture ids make a red test impossible to trace back to a run",
    );
  });

  test("dates every entry, so a recurrence is visible as one", () => {
    for (const f of PRODUCTION_FAILURES) {
      assert.match(f.date, /^\d{4}-\d{2}-\d{2}$/, `${f.id} needs a real date`);
      assert.ok(f.because.length > 40, `${f.id} needs a real explanation`);
    }
  });
});
