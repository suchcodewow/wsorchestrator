/**
 * The Guest judges list as the cohorts it heads. A page of results is cut
 * from one long list ordered by month, and the months set aside for a cohort
 * with no one in it yet are slotted in among them, so these pin that each
 * empty month shows exactly once, in order, however the list is paged.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { formatTenure, groupByCohort, guestSpeakerSchema, isProspectGroup } from "@/lib/logistics/guest-judge-values";

const row = (month: string, name: string) => ({ month, name });
const months = (groups: { month: string; rows: unknown[] }[]) => groups.map((g) => `${g.month}:${g.rows.length}`);
const ONE_PAGE = { first: true, last: true, newestFirst: true, searching: false };

describe("grouping guest judges by cohort", () => {
  const rows = [row("2026-09-01", "Ana"), row("2026-09-01", "Bo"), row("2026-07-01", "Cy"), row("2026-06-01", "Di")];

  test("heads each month once, keeping the order the rows came in", () => {
    assert.deepEqual(months(groupByCohort(rows, [], ONE_PAGE)), ["2026-09-01:2", "2026-07-01:1", "2026-06-01:1"]);
  });

  test("puts an empty cohort where it falls, newest first or oldest", () => {
    assert.deepEqual(months(groupByCohort(rows, ["2026-11-01", "2026-08-01"], ONE_PAGE)), [
      "2026-11-01:0",
      "2026-09-01:2",
      "2026-08-01:0",
      "2026-07-01:1",
      "2026-06-01:1",
    ]);
    const oldest = [...rows].reverse();
    assert.deepEqual(months(groupByCohort(oldest, ["2026-11-01"], { ...ONE_PAGE, newestFirst: false })), [
      "2026-06-01:1",
      "2026-07-01:1",
      "2026-09-01:2",
      "2026-11-01:0",
    ]);
  });

  test("shows an empty cohort past the page's ends only on the first or last page", () => {
    const middle = { first: false, last: false, newestFirst: true, searching: false };
    assert.deepEqual(months(groupByCohort(rows, ["2026-11-01", "2026-08-01", "2026-01-01"], middle)), [
      "2026-09-01:2",
      "2026-08-01:0",
      "2026-07-01:1",
      "2026-06-01:1",
    ]);
  });

  test("shows the empty cohorts alone when there is no one yet, and none for a search", () => {
    assert.deepEqual(months(groupByCohort([], ["2026-11-01"], ONE_PAGE)), ["2026-11-01:0"]);
    assert.deepEqual(months(groupByCohort(rows, ["2026-11-01"], { ...ONE_PAGE, searching: true })), [
      "2026-09-01:2",
      "2026-07-01:1",
      "2026-06-01:1",
    ]);
  });

  test("does not show a month twice when it has people and was set aside too", () => {
    assert.deepEqual(months(groupByCohort(rows, ["2026-09-01"], ONE_PAGE)), ["2026-09-01:2", "2026-07-01:1", "2026-06-01:1"]);
  });
});

describe("a guest speaker entry", () => {
  const entry = { cohort: "2026-11", program: "bootcamp", role: "judge", fullName: "  Pat Example " };

  test("takes a month, a name and no email for someone not in HiBob", () => {
    const parsed = guestSpeakerSchema.parse(entry);
    assert.equal(parsed.fullName, "Pat Example");
    assert.equal(parsed.email, null);
    assert.equal(parsed.session, "");
  });

  test("refuses a month that is not one, or no name", () => {
    assert.ok(!guestSpeakerSchema.safeParse({ ...entry, cohort: "2026-13" }).success);
    assert.ok(!guestSpeakerSchema.safeParse({ ...entry, cohort: "2026-11-01" }).success);
    assert.ok(!guestSpeakerSchema.safeParse({ ...entry, fullName: " " }).success);
  });
});

describe("a leader's tenure and group", () => {
  test("reads as years and months, leaving out a zero", () => {
    assert.equal(formatTenure(0), "Under a month");
    assert.equal(formatTenure(11), "11 mo");
    assert.equal(formatTenure(24), "2 yr");
    assert.equal(formatTenure(38), "3 yr 2 mo");
    assert.equal(formatTenure(null), "—");
  });

  test("takes only the two groups the toggle offers", () => {
    assert.ok(isProspectGroup("sales") && isProspectGroup("se"));
    assert.ok(!isProspectGroup("Sales") && !isProspectGroup("") && !isProspectGroup(undefined));
  });
});
