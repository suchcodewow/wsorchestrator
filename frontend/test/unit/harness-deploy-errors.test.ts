/**
 * What someone deploying content into a Harness organization is told when it
 * fails, and the HTTP status the API answers with.
 *
 * The deploy API returns an error code; the page turns it into a sentence with
 * `messageFor`. A code with no sentence reads as "Something went wrong", which
 * gives the person nothing to act on, and a status in the wrong class makes a
 * client error look like an outage (or the reverse). These tests pin the table
 * as the specification: every code has both, the statuses are the ones the
 * route promises, and whatever Harness itself said is appended rather than
 * replacing the explanation.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { MESSAGES, STATUS_FOR, messageFor, type DeployError } from "@/lib/harness-deploy-errors";

const EXPECTED_STATUS: Record<DeployError, number> = {
  not_found: 404,
  unreadable: 409,
  invalid_token: 409,
  not_permitted: 403,
  invalid_name: 400,
  nothing_selected: 400,
  org_exists: 409,
  org_failed: 502,
  harness_error: 502,
  unreachable: 504,
};

describe("STATUS_FOR", () => {
  test("is exactly the specified status for every code", () => {
    assert.deepEqual(STATUS_FOR, EXPECTED_STATUS);
  });

  test("blames Harness (5xx) only for failures on Harness's side", () => {
    const upstream = new Set<DeployError>(["org_failed", "harness_error", "unreachable"]);
    for (const [code, status] of Object.entries(STATUS_FOR)) {
      assert.equal(status >= 500, upstream.has(code as DeployError), code);
    }
  });
});

describe("MESSAGES", () => {
  test("covers exactly the codes STATUS_FOR does", () => {
    assert.deepEqual(Object.keys(MESSAGES).sort(), Object.keys(STATUS_FOR).sort());
  });

  test("every message is a non-empty sentence, so a detail can follow it", () => {
    for (const [code, message] of Object.entries(MESSAGES)) {
      assert.ok(message.trim().length > 0, code);
      assert.match(message, /[.!?]$/, `${code} must end in punctuation`);
      assert.equal(message, message.trim(), code);
    }
  });

  test("invalid_name matches what harnessIdentifier needs", () => {
    // harnessIdentifier returns null exactly when no letter, digit, or
    // underscore survives, which is what this sentence tells the person.
    assert.match(MESSAGES.invalid_name, /letter, digit, or underscore/);
  });
});

describe("messageFor", () => {
  test("returns the sentence for a known code", () => {
    for (const code of Object.keys(MESSAGES) as DeployError[]) {
      assert.equal(messageFor(code, STATUS_FOR[code]), MESSAGES[code]);
    }
  });

  test("appends what Harness said, trimmed", () => {
    assert.equal(
      messageFor("org_failed", 502, "  Quota exceeded \n"),
      `${MESSAGES.org_failed} Harness said: Quota exceeded`,
    );
  });

  test("ignores a detail that is blank or not a string", () => {
    for (const detail of [undefined, null, "", "   ", "\n\t", 42, { message: "x" }, ["x"]]) {
      assert.equal(messageFor("unreachable", 504, detail), MESSAGES.unreachable, JSON.stringify(detail));
    }
  });

  test("falls back to the status for an unknown or missing code", () => {
    assert.equal(messageFor("no_such_code", 500), "Something went wrong (500).");
    assert.equal(messageFor(undefined, 418), "Something went wrong (418).");
    assert.equal(messageFor(null, 0), "Something went wrong (0).");
    assert.equal(messageFor(42, 400), "Something went wrong (400).");
    assert.equal(messageFor("", 400), "Something went wrong (400).");
  });

  test("an unknown code never gets the Harness detail appended", () => {
    assert.equal(messageFor("nope", 502, "raw upstream text"), "Something went wrong (502).");
  });

  test("falls back for a code that names an Object.prototype member", () => {
    for (const code of ["toString", "constructor", "hasOwnProperty", "__proto__"]) {
      assert.equal(messageFor(code, 500), "Something went wrong (500).", code);
    }
  });
});
