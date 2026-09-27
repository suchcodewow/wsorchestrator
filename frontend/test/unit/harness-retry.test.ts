/**
 * Which Harness replies the deployer tries again, and which it counts as
 * "already there".
 *
 * Both mistakes are silent. Reading a real refusal as a duplicate reports an
 * entity as deployed that never was, and the workshop is missing it with
 * nobody told; failing to read a duplicate as one fails a deploy on a call that
 * succeeded — which is how two production runs were lost to
 * `already part of User Group` before it was added (commit 83f04b4).
 *
 * `runner/test/harness-errors.test.ts` checks this copy against the runner's
 * over the production-failure corpus. This file pins the frontend copy's own
 * edges, using the verbatim replies from that corpus.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { isDuplicate, isRetryable } from "@/lib/harness-retry";

/** `aws-cardinal`, 2026-09-07: the grant landed, then Harness refused it. */
const ALREADY_IN_PROJECT_GROUP =
  '{"status":"ERROR","code":"INVALID_REQUEST","message":"Invalid request: ' +
  "Invalid format of YAML payload: HTTP Error Status (400 - Invalid Format) " +
  "received. Invalid request: User J08YRCFQRqOdvjDglAN6EA is already part " +
  'of User Group _project_all_users","correlationId":"1d3bef2f-375f-4886-b4a1-2a38a20656c8"}';

/** `aws-platform-team`, 2026-08-21: the same defect at org scope. */
const ALREADY_IN_ORG_GROUP =
  '{"status":"ERROR","code":"INVALID_REQUEST","message":"Invalid request: ' +
  "Invalid format of YAML payload: HTTP Error Status (400 - Invalid Format) " +
  "received. Invalid request: User vqSNJDCJTaax0gYN3FrC1Q is already part " +
  'of User Group _organization_all_users","correlationId":"b98f298b-d173-41c4-876c-6e788c56e5cf"}';

/** `aws`, 2026-08-23: a genuine scope mistake that must keep failing. */
const PROJECT_SECRET_AT_ORG_SCOPE =
  '{"status":"ERROR","code":"INVALID_REQUEST","message":"Invalid request: ' +
  "Error while validating secretKeyRef field : Invalid request: The project " +
  'level secret cannot be used at a org level","correlationId":"6a1d86dc-a9c4-42c1-85a0-f26df0d1fec4"}';

describe("isRetryable", () => {
  test("retries rate limiting and every server error", () => {
    for (const status of [429, 500, 502, 503, 504, 599]) {
      assert.equal(isRetryable(status), true, String(status));
    }
  });

  test("does not retry success or a client error, which will only fail again", () => {
    for (const status of [200, 201, 204, 400, 401, 403, 404, 409, 422, 428, 430, 499]) {
      assert.equal(isRetryable(status), false, String(status));
    }
  });

  test("does not treat status 0 (no reply at all) as a retryable status", () => {
    // A network failure is caught and retried separately by the caller; the
    // synthetic status 0 it records must not be mistaken for a 5xx.
    assert.equal(isRetryable(0), false);
  });
});

describe("isDuplicate", () => {
  test("any 409 is a conflict, whatever the body says", () => {
    assert.equal(isDuplicate(409, ""), true);
    assert.equal(isDuplicate(409, "Something unrelated"), true);
  });

  test("reads Harness's DUPLICATE_FIELD code on a 400", () => {
    assert.equal(
      isDuplicate(400, '{"status":"ERROR","code":"DUPLICATE_FIELD","message":"x"}'),
      true,
    );
  });

  test("reads 'already exists' and 'duplicate' in any case", () => {
    assert.equal(isDuplicate(400, "Organization already exists"), true);
    assert.equal(isDuplicate(400, "Secret with identifier [aws] ALREADY EXISTS"), true);
    assert.equal(isDuplicate(400, "Duplicate identifier"), true);
    assert.equal(isDuplicate(500, "duplicate key value violates unique constraint"), true);
  });

  test("reads 'already part of User Group' at project and org scope as done", () => {
    assert.equal(isDuplicate(400, ALREADY_IN_PROJECT_GROUP), true);
    assert.equal(isDuplicate(400, ALREADY_IN_ORG_GROUP), true);
    assert.equal(isDuplicate(400, "user x is ALREADY PART OF USER GROUP y"), true);
  });

  test("does not swallow a genuine refusal", () => {
    assert.equal(isDuplicate(400, PROJECT_SECRET_AT_ORG_SCOPE), false);
    assert.equal(isDuplicate(400, "Invalid request: name is required"), false);
    assert.equal(isDuplicate(400, ""), false);
    assert.equal(isDuplicate(401, "Invalid API key"), false);
    assert.equal(isDuplicate(404, "Resource not found"), false);
    assert.equal(isDuplicate(500, "Oops, something went wrong"), false);
  });

  test("does not match the policy API's wording, which harness-deploy handles itself", () => {
    // The policy API answers a repeated create with HTTP 400 and this body;
    // `harness-deploy.ts` has a separate check for it, so matching it here too
    // would be harmless but is not what this rule claims to do.
    const body = JSON.stringify({
      name: "BadRequest",
      id: "4w215m-9",
      message: "policy identifier must be unique",
    });
    assert.equal(isDuplicate(400, body), false);
  });

  test("does not read a near miss as already done", () => {
    assert.equal(isDuplicate(400, "User is not part of User Group"), false);
    assert.equal(isDuplicate(400, "the org does not exist"), false);
  });
});
