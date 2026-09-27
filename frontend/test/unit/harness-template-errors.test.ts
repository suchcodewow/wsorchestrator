/**
 * What someone is told when adding a template source fails, and the HTTP
 * status the API answers with.
 *
 * A template source is a token plus an org and project to copy templates from,
 * so its errors are the token check's (`CheckError` from harness-platform) plus
 * the scope lookups and the limits. The token-check codes are shared with the
 * token settings page, and a person who sees both should read the same sentence
 * for the same failure — so those are pinned against `harness-token-errors` as
 * well as against the table below.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { MAX_TEMPLATE_SOURCES } from "@/db/schema";
import type { CheckError } from "@/lib/harness-platform";
import {
  MESSAGES,
  STATUS_FOR,
  messageFor,
  type TemplateSourceError,
} from "@/lib/harness-template-errors";
import * as tokenErrors from "@/lib/harness-token-errors";

const EXPECTED_STATUS: Record<TemplateSourceError, number> = {
  malformed: 400,
  invalid_token: 409,
  org_not_found: 409,
  project_not_found: 409,
  duplicate: 409,
  too_many: 409,
  not_found: 404,
  harness_error: 502,
  unreachable: 504,
  no_key: 503,
};

/** Every `CheckError`, spelled out so a new one added upstream shows up here. */
const CHECK_ERRORS: CheckError[] = ["malformed", "invalid_token", "harness_error", "unreachable"];

describe("STATUS_FOR", () => {
  test("is exactly the specified status for every code", () => {
    assert.deepEqual(STATUS_FOR, EXPECTED_STATUS);
  });

  test("covers every token-check error", () => {
    for (const code of CHECK_ERRORS) assert.ok(code in STATUS_FOR, code);
  });

  test("a missing org or project is the person's choice, not an outage", () => {
    assert.ok(STATUS_FOR.org_not_found < 500);
    assert.ok(STATUS_FOR.project_not_found < 500);
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

  test("too_many names the actual limit", () => {
    assert.ok(MESSAGES.too_many.includes(`(${MAX_TEMPLATE_SOURCES} is the limit)`));
  });

  test("the token-check failures read the same here as on the token page", () => {
    for (const code of CHECK_ERRORS) {
      assert.equal(MESSAGES[code], tokenErrors.MESSAGES[code], code);
      assert.equal(STATUS_FOR[code], tokenErrors.STATUS_FOR[code], code);
    }
    assert.equal(MESSAGES.no_key, tokenErrors.MESSAGES.no_key);
  });
});

describe("messageFor", () => {
  test("returns the sentence for a known code", () => {
    for (const code of Object.keys(MESSAGES) as TemplateSourceError[]) {
      assert.equal(messageFor(code, STATUS_FOR[code]), MESSAGES[code]);
    }
  });

  test("appends what Harness said, trimmed", () => {
    assert.equal(
      messageFor("project_not_found", 409, "\tProject [demo] not found  "),
      `${MESSAGES.project_not_found} Harness said: Project [demo] not found`,
    );
  });

  test("ignores a detail that is blank or not a string", () => {
    for (const detail of [undefined, null, "", "   ", 1, true]) {
      assert.equal(messageFor("too_many", 409, detail), MESSAGES.too_many, JSON.stringify(detail));
    }
  });

  test("falls back to the status for an unknown or missing code", () => {
    assert.equal(messageFor("org_exists", 409), "Something went wrong (409).");
    assert.equal(messageFor(undefined, 500), "Something went wrong (500).");
    assert.equal(messageFor({}, 400, "detail"), "Something went wrong (400).");
  });

  test("falls back for a code that names an Object.prototype member", () => {
    for (const code of ["toString", "constructor"]) {
      assert.equal(messageFor(code, 500), "Something went wrong (500).", code);
    }
  });
});
