/**
 * The HTTP status the repository settings API answers with for each refusal.
 *
 * This is the only pure export of harness-repos; `listRepos`, `addRepo`,
 * `updateRepo` and `deleteRepo` all go to the database and are not exercised
 * here. The rules they apply to what was pasted live in `github-repos.ts` and
 * are covered by `github-repos.test.ts`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { STATUS_FOR, type RepoError } from "@/lib/harness-repos";

test("every refusal has the specified status", () => {
  const expected: Record<RepoError, number> = {
    invalid_url: 400,
    invalid_identifier: 400,
    invalid_scope: 400,
    duplicate: 409,
    not_found: 404,
  };
  assert.deepEqual(STATUS_FOR, expected);
});

test("none of them is reported as a server error", () => {
  // Every repository refusal is about what was submitted; a 5xx would send
  // the administrator looking for an outage instead of at their paste.
  for (const [code, status] of Object.entries(STATUS_FOR)) {
    assert.ok(status >= 400 && status < 500, code);
  }
});
