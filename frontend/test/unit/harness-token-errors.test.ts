/**
 * What an administrator is told when saving or rechecking a Harness token
 * fails, and the HTTP status the token API answers with.
 *
 * The API returns a code and the settings page turns it into a sentence with
 * `messageFor`. A code missing its sentence reads as "Something went wrong",
 * and a 5xx for what is really a bad paste sends someone looking for an outage.
 * The table below is the specification, written out rather than derived.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { MESSAGES, STATUS_FOR, messageFor, type HarnessTokenError } from "@/lib/harness-token-errors";

const EXPECTED_STATUS: Record<HarnessTokenError, number> = {
  malformed: 400,
  invalid_token: 409,
  duplicate: 409,
  too_many: 409,
  unreadable: 409,
  not_found: 404,
  harness_error: 502,
  unreachable: 504,
  no_key: 503,
};

describe("STATUS_FOR", () => {
  test("is exactly the specified status for every code", () => {
    assert.deepEqual(STATUS_FOR, EXPECTED_STATUS);
  });

  test("answers 5xx only when Harness or this deployment is at fault", () => {
    const serverSide = new Set<HarnessTokenError>(["harness_error", "unreachable", "no_key"]);
    for (const [code, status] of Object.entries(STATUS_FOR)) {
      assert.equal(status >= 500, serverSide.has(code as HarnessTokenError), code);
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
    }
  });

  test("malformed describes the shape parseHarnessToken accepts", () => {
    assert.match(MESSAGES.malformed, /pat\. or sat\./);
    assert.match(MESSAGES.malformed, /four dot-separated parts/);
  });
});

describe("messageFor", () => {
  test("returns the sentence for a known code", () => {
    for (const code of Object.keys(MESSAGES) as HarnessTokenError[]) {
      assert.equal(messageFor(code, STATUS_FOR[code]), MESSAGES[code]);
    }
  });

  test("appends what Harness said, trimmed", () => {
    assert.equal(
      messageFor("invalid_token", 409, " Invalid API key "),
      `${MESSAGES.invalid_token} Harness said: Invalid API key`,
    );
  });

  test("ignores a detail that is blank or not a string", () => {
    for (const detail of [undefined, null, "", "  ", 0, false, {}]) {
      assert.equal(messageFor("duplicate", 409, detail), MESSAGES.duplicate, JSON.stringify(detail));
    }
  });

  test("falls back to the status for an unknown or missing code", () => {
    assert.equal(messageFor("unknown", 500), "Something went wrong (500).");
    assert.equal(messageFor(undefined, 502), "Something went wrong (502).");
    assert.equal(messageFor("MALFORMED", 400), "Something went wrong (400).");
    assert.equal(messageFor("nope", 500, "detail"), "Something went wrong (500).");
  });

  test("falls back for a code that names an Object.prototype member", () => {
    for (const code of ["toString", "constructor", "valueOf"]) {
      assert.equal(messageFor(code, 500), "Something went wrong (500).", code);
    }
  });
});
