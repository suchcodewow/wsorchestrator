/**
 * The attendee page's guards: the checks that run before either function
 * touches the database.
 *
 * The attendee page is reachable by anyone holding the link — no sign-in — so
 * its run id comes straight from the URL. A malformed one has to be answered
 * as "not found" before it reaches a `uuid` column, where Postgres would throw
 * and the page would 500. The claim fields an attendee types are capped at
 * `CLAIM_LIMITS`; an over-long value is refused before the update is built.
 *
 * Only the paths that return before querying are exercised here, which is why
 * nothing below checks that a value *at* the limit is accepted — that path
 * runs the update. The link
 * building (`sharedLinks`, `competitorLinks`) is private and reached only
 * through `getAttendeeView`, which reads the database.
 */

import { before, describe, test } from "node:test";
import assert from "node:assert/strict";

import { CLAIM_LIMITS } from "@/db/schema";

// Every case below is meant to return before a query. If one ever did not, it
// should fail to connect rather than reach whatever DATABASE_URL points at —
// so the pool is pointed at a closed port before the module that creates it
// is loaded.
process.env.DATABASE_URL = "postgresql://nobody@127.0.0.1:1/unit_tests_do_not_connect";
let getAttendeeView: typeof import("@/lib/attendees").getAttendeeView;
let saveAttendeeFields: typeof import("@/lib/attendees").saveAttendeeFields;
before(async () => {
  ({ getAttendeeView, saveAttendeeFields } = await import("@/lib/attendees"));
});

const RUN = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const blank = { name: "", from: "", vacation: "" };

const NOT_UUIDS = [
  "",
  "not-a-run",
  "3f2504e04f8911d39a0c0305e82c3301",
  `${RUN}'; drop table workshop_runs; --`,
  ` ${RUN}`,
];

describe("getAttendeeView", () => {
  test("a run id that is not a uuid is null without a query", async () => {
    for (const id of NOT_UUIDS) {
      assert.equal(await getAttendeeView(id), null, JSON.stringify(id));
    }
  });
});

describe("saveAttendeeFields", () => {
  test("a run id that is not a uuid is not_found without a query", async () => {
    for (const id of NOT_UUIDS) {
      assert.deepEqual(await saveAttendeeFields(id, 1, blank), { ok: false, error: "not_found" }, JSON.stringify(id));
    }
  });

  test("the uuid check comes before the length check", async () => {
    assert.deepEqual(
      await saveAttendeeFields("nope", 1, { ...blank, name: "x".repeat(1000) }),
      { ok: false, error: "not_found" },
    );
  });

  for (const field of ["name", "from", "vacation"] as const) {
    test(`a ${field} one character over ${CLAIM_LIMITS[field]} is invalid`, async () => {
      const input = { ...blank, [field]: "x".repeat(CLAIM_LIMITS[field] + 1) };
      assert.deepEqual(await saveAttendeeFields(RUN, 1, input), { ok: false, error: "invalid" });
    });

    test(`a ${field} over the limit is invalid even when surrounded by whitespace`, async () => {
      const input = { ...blank, [field]: `  ${"x".repeat(CLAIM_LIMITS[field] + 1)}  ` };
      assert.deepEqual(await saveAttendeeFields(RUN, 1, input), { ok: false, error: "invalid" });
    });
  }

  test("the limits are the ones the claim form is sized for", () => {
    assert.deepEqual(CLAIM_LIMITS, { name: 80, from: 80, vacation: 120 });
  });
});
