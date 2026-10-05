/**
 * Reading Mindtickle's records for a Canary Wire pull. The statements are
 * shaped the way the live xAPI sends them, with both of its quirks: every
 * statement in a sweep carries the same `timestamp` (the moment it was asked),
 * and the real event time hides in `stored`, divided by 1000. A statement
 * with no event behind it repeats the query time in `stored`, which once made
 * every untouched module look freshly worked on.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  bestProgress,
  displayName,
  learnerFrom,
  managerEmail,
  matchesAll,
  matchesAny,
  splitMonth,
  statementEventMoment,
  statementState,
  type MtRecord,
} from "@/lib/canary-wire/records";

const QUERY_TIME = "2026-09-24T13:10:30.225Z";
const NOW = Date.parse("2026-09-25T00:00:00Z");

/** The event time as Mindtickle stores it: the epoch divided by 1000. */
const buggyStored = (iso: string) => new Date(Date.parse(iso) / 1000).toISOString();

function statement(moduleId: string, verb: string, at: string): MtRecord {
  return {
    verb: { id: `http://adlnet.gov/expapi/verbs/${verb}`, display: { "en-US": verb } },
    object: { id: moduleId },
    timestamp: QUERY_TIME,
    stored: verb === "not_started" ? QUERY_TIME : buggyStored(at),
  };
}

describe("statements", () => {
  test("the real moment is recovered from `stored`, to the second", () => {
    assert.equal(buggyStored("2026-09-12T10:00:00.000Z").slice(0, 4), "1970");
    assert.equal(statementEventMoment(statement("m", "completed", "2026-09-12T10:00:00.000Z"), NOW), "2026-09-12T10:00:00Z");
  });

  test("a `stored` that is already a real date is kept, fraction and all", () => {
    assert.equal(statementEventMoment({ timestamp: QUERY_TIME, stored: "2026-09-12T10:00:00.076Z" }, NOW), "2026-09-12T10:00:00.076000Z");
  });

  test("no event behind it, or nothing plausible, is no moment", () => {
    assert.equal(statementEventMoment(statement("m", "not_started", ""), NOW), "");
    assert.equal(statementEventMoment({ timestamp: QUERY_TIME, stored: "1970-01-01T00:00:01Z" }, NOW), "");
    assert.equal(statementEventMoment({ timestamp: QUERY_TIME, stored: "not a date" }, NOW), "");
  });

  test("the verb's wording, its id when it has none, and anything else as it came", () => {
    assert.equal(statementState(statement("m", "in_progress", "2026-09-12T10:00:00Z")), "In Progress");
    assert.equal(statementState({ verb: { id: "http://adlnet.gov/expapi/verbs/completed/" } }), "Completed");
    assert.equal(statementState({ verb: { display: { "en-US": "Not-Started" } } }), "Not Started");
    assert.equal(statementState({ verb: { display: { "en-US": "timedout" } } }), "timedout");
    assert.equal(statementState({}), "Unknown");
  });

  test("one entry per module: the furthest state, then the latest day", () => {
    const { best, newest } = bestProgress(
      [
        statement("flex", "in_progress", "2026-09-10T10:00:00Z"),
        statement("flex", "completed", "2026-09-12T10:00:00Z"),
        // A later in-progress doesn't undo a completion.
        statement("flex", "in_progress", "2026-09-20T10:00:00Z"),
        statement("emd", "not_started", ""),
        { object: {}, timestamp: QUERY_TIME },
      ],
      NOW,
    );
    assert.deepEqual(best, {
      flex: { state: "Completed", on: "2026-09-12", at: "2026-09-12T10:00:00Z" },
      emd: { state: "Not Started", on: "", at: "" },
    });
    assert.equal(newest, QUERY_TIME);
  });
});

describe("names", () => {
  test("a module's month comes from its name's prefix", () => {
    assert.deepEqual(splitMonth("September 2026 - Flex Pricing"), ["September 2026", "Flex Pricing"]);
    assert.deepEqual(splitMonth("october 2026 – Handling Objections: MYKO"), ["October 2026", "Handling Objections: MYKO"]);
    assert.deepEqual(splitMonth("Onboarding basics"), ["", "Onboarding basics"]);
  });

  test("a series is matched on every pattern, an exclusion on any", () => {
    assert.ok(matchesAll("The Canary Wire - SE  Edition", ["canary wire", "se edition"]));
    assert.ok(!matchesAll("The Canary Wire - SDR Edition", ["canary wire", "se edition"]));
    assert.ok(matchesAny("September 2026 - Feedback Survey", ["survey"]));
  });

  test("a manager's email and their profile name reduce to one display name", () => {
    assert.equal(displayName("ada.lovelace@harness.io"), "Ada Lovelace");
    assert.equal(displayName("pat_o'hara@harness.io"), "Pat O'Hara");
    assert.equal(displayName("ADA LOVELACE"), "Ada Lovelace");
    assert.equal(displayName(""), "");
  });
});

describe("learnerFrom", () => {
  test("reads a user record with its obfuscated profile keys", () => {
    const user = {
      email: " Bo@Harness.io ",
      name: "Bo",
      userState: "active",
      profile: { dg: "Account Executive", dp: "Sales", a_0: "ada lovelace" },
      managers: [
        { key: "User_Manager", email: "org.chart@harness.io" },
        // The custom field is the frontline manager Harness fills in, so it wins.
        { key: "a_0", email: "ada.lovelace@harness.io" },
      ],
    };
    assert.deepEqual(learnerFrom(user, "SE"), {
      email: "Bo@Harness.io",
      name: "Bo",
      role: "SE",
      manager: "Ada Lovelace",
      manager_email: "ada.lovelace@harness.io",
      title: "Account Executive",
      state: "ACTIVE",
    });
  });

  test("with no managers[], the profile's name still finds the manager", () => {
    const learner = learnerFrom({ email: "cy@harness.io", profile: { a_0: "ada lovelace" } }, "SE");
    assert.deepEqual([learner.manager, learner.manager_email], ["Ada Lovelace", ""]);
    assert.equal(managerEmail({ managers: [{ key: "x", email: "only@harness.io" }] }), "only@harness.io");
  });
});
