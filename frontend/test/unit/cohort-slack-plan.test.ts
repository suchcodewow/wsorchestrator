/** The cohort Slack channels: their names, who belongs in each, and who the sync may invite or remove. */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  channelAudience,
  channelSuffix,
  cohortChannels,
  planMembership,
  type CohortMember,
} from "../../src/lib/cohorts/slack-plan";

test("the suffix is the start date's three-letter month and four-digit year", () => {
  assert.equal(channelSuffix("2026-11-09"), "nov-2026");
  assert.equal(channelSuffix("2027-01-31"), "jan-2027");
  assert.equal(channelSuffix("2026-09-01"), "sep-2026");
});

test("a malformed start date is refused rather than named nonsense", () => {
  assert.throws(() => channelSuffix("2026-13-01"));
  assert.throws(() => channelSuffix("Nov 2026"));
});

test("a bootcamp with an intermediate class has four channels, sales and se for each stage", () => {
  assert.deepEqual(
    cohortChannels("2026-11-09", true).map((c) => c.name),
    ["sales-bootcamp-nov-2026", "se-bootcamp-nov-2026", "sales-intermediate-nov-2026", "se-intermediate-nov-2026"],
  );
});

test("a bootcamp with no intermediate class has only the bootcamp pair", () => {
  assert.deepEqual(
    cohortChannels("2026-11-09", false).map((c) => c.kind),
    ["sales_bootcamp", "se_bootcamp"],
  );
});

const cohort: CohortMember[] = [
  { email: "Seller@harness.io", stage: "bootcamp", track: "sales" },
  { email: "eng@harness.io", stage: "bootcamp", track: "engineer" },
  { email: "int-seller@harness.io", stage: "intermediate", track: "sales" },
  { email: "int-eng@harness.io", stage: "intermediate", track: "engineer" },
];
const contacts = [
  { email: "bootcamp-contact@harness.io", kind: "sales" as const },
  { email: "eng-contact@harness.io", kind: "se" as const },
];
const [salesBtc, seBtc, salesInt, seInt] = cohortChannels("2026-11-09", true);

test("a sales- channel holds its stage's Sales and Engineers and the Bootcamp Contacts, lowercased", () => {
  assert.deepEqual(
    [...channelAudience(salesBtc!, cohort, contacts)].sort(),
    ["bootcamp-contact@harness.io", "eng@harness.io", "seller@harness.io"],
  );
  assert.deepEqual(
    [...channelAudience(salesInt!, cohort, contacts)].sort(),
    ["bootcamp-contact@harness.io", "int-eng@harness.io", "int-seller@harness.io"],
  );
});

test("an se- channel holds its stage's Engineers and the Engineer Contacts, and no Sales", () => {
  assert.deepEqual([...channelAudience(seBtc!, cohort, contacts)].sort(), ["eng-contact@harness.io", "eng@harness.io"]);
  assert.deepEqual([...channelAudience(seInt!, cohort, contacts)].sort(), ["eng-contact@harness.io", "int-eng@harness.io"]);
});

test("everyone wanted and not there is invited", () => {
  const plan = planMembership({ wanted: new Set(["U2", "U1"]), members: new Set(["U9"]), invitedBySync: new Set() });
  assert.deepEqual(plan, { invite: ["U1", "U2"], remove: [], forget: [] });
});

test("someone the sync did not invite is never removed, wanted or not", () => {
  const plan = planMembership({ wanted: new Set(), members: new Set(["U1", "U2"]), invitedBySync: new Set() });
  assert.deepEqual(plan.remove, []);
});

test("someone the sync invited who no longer belongs is removed", () => {
  const plan = planMembership({
    wanted: new Set(["U1"]),
    members: new Set(["U1", "U2", "U3"]),
    invitedBySync: new Set(["U1", "U2"]),
  });
  assert.deepEqual(plan, { invite: [], remove: ["U2"], forget: [] });
});

test("someone the sync invited who left on their own is forgotten, and invited again if still wanted", () => {
  const plan = planMembership({
    wanted: new Set(["U1"]),
    members: new Set(),
    invitedBySync: new Set(["U1", "U2"]),
  });
  assert.deepEqual(plan, { invite: ["U1"], remove: [], forget: ["U1", "U2"] });
});
