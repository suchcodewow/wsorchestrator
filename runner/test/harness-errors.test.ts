/**
 * How Harness replies are read: already-done, worth retrying, or a real refusal.
 *
 * Two copies of these rules exist on purpose — `runner/src/harness.ts` for the
 * provisioning runner and `frontend/src/lib/harness-retry.ts` for the component
 * deployer — because they are separate services with separate builds and a
 * shared package between them would cost more than twenty duplicated lines. The
 * comments in both say they are meant to agree. This file is what makes that
 * true rather than aspirational: one corpus, both implementations, same verdicts.
 *
 * Reaching across into the frontend's source is deliberate. The alternative is
 * two suites that pass independently while the rules drift apart, which is the
 * exact failure the duplication invites.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { isDuplicate } from "../src/harness.js";
import { isDuplicate as isDuplicateFrontend } from "../../frontend/src/lib/harness-retry.ts";
import {
  PRODUCTION_FAILURES,
  expecting,
  failure,
} from "./fixtures/production-failures.js";

/** The two copies that have to stay in step. */
const IMPLEMENTATIONS = [
  { name: "runner/src/harness.ts", isDuplicate },
  { name: "frontend/src/lib/harness-retry.ts", isDuplicate: isDuplicateFrontend },
] as const;

describe("isDuplicate", () => {
  for (const impl of IMPLEMENTATIONS) {
    describe(impl.name, () => {
      for (const f of expecting("already-satisfied")) {
        test(`treats ${f.id} (${f.run}, ${f.date}) as already done`, () => {
          assert.equal(
            impl.isDuplicate(f.status ?? 400, f.message),
            true,
            f.because,
          );
        });
      }

      test("does not swallow a genuine Harness refusal", () => {
        const f = failure("harness-project-secret-at-org-scope");
        assert.equal(impl.isDuplicate(f.status ?? 400, f.message), false, f.because);
      });

      test("still reads the shapes it always did", () => {
        assert.equal(impl.isDuplicate(409, ""), true, "a bare 409 is a conflict");
        assert.equal(
          impl.isDuplicate(400, '{"code":"DUPLICATE_FIELD"}'),
          true,
          "Harness's own duplicate code",
        );
        assert.equal(
          impl.isDuplicate(400, "Organization already exists"),
          true,
        );
      });

      test("does not read an unrelated 400 as success", () => {
        // The cost of a false positive here is silence: a create that never
        // happened is reported as having already been there, and the workshop
        // is missing an entity nobody was told about.
        assert.equal(impl.isDuplicate(400, "Invalid request: name is required"), false);
        assert.equal(impl.isDuplicate(400, ""), false);
        assert.equal(impl.isDuplicate(500, "Oops, something went wrong"), false);
      });
    });
  }

  test("both copies agree on the whole corpus", () => {
    // The assertion that earns the duplication. A signature added to one side
    // and forgotten on the other fails here rather than in a workshop.
    for (const f of PRODUCTION_FAILURES) {
      const status = f.status ?? 400;
      assert.equal(
        isDuplicate(status, f.message),
        isDuplicateFrontend(status, f.message),
        `runner and frontend disagree about ${f.id} — the two copies of ` +
          `isDuplicate have drifted; see the note in harness-retry.ts`,
      );
    }
  });
});
