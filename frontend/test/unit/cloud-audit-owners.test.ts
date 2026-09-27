/**
 * Matching cloud resources to the runs that claim them — the pure half.
 *
 * `missingFromCloud` is the other direction of the audit: resources a run
 * still claims that the cloud no longer has, which is how a teardown that
 * happened outside the runner shows up. Infrastructure the site itself runs on
 * is excluded, since it is never a run's to lose.
 *
 * `normalizeId` exists because Azure resource-group names are
 * case-insensitive and come back from ARM in whatever case they were created
 * with; GCP project ids, AWS account ids and Harness identifiers are compared
 * exactly. `resourceOwners` reads the database and is not exercised here.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { missingFromCloud, normalizeId } from "@/lib/cloud-audit/owners";
import { owner } from "../support/cloud-audit";

describe("normalizeId", () => {
  test("lowercases Azure resource-group names", () => {
    assert.equal(normalizeId("azure", "WO-Run-ABC"), "wo-run-abc");
  });

  test("leaves every other target's ids exactly as given", () => {
    assert.equal(normalizeId("gcp", "My-Project"), "My-Project");
    assert.equal(normalizeId("aws", "123456789012"), "123456789012");
    assert.equal(normalizeId("harness", "Workshop_Org"), "Workshop_Org");
  });
});

describe("missingFromCloud", () => {
  const owners = new Map([
    ["p1", owner("r1")],
    ["p2", owner("r2", { attendee: "a@example.com" })],
    ["p3", owner("r3")],
  ]);

  test("lists claimed ids the cloud did not return, with their owner", () => {
    assert.deepEqual(missingFromCloud(owners, ["p1", "p3", "unclaimed"]), [
      { id: "p2", ...owner("r2", { attendee: "a@example.com" }) },
    ]);
  });

  test("ignores the ids it is told to", () => {
    assert.deepEqual(missingFromCloud(owners, ["p1"], new Set(["p2", "p3"])), []);
  });

  test("everything is missing when the cloud returned nothing", () => {
    assert.deepEqual(
      missingFromCloud(owners, []).map((m) => m.id),
      ["p1", "p2", "p3"],
    );
  });

  test("nothing is missing when nothing is claimed", () => {
    assert.deepEqual(missingFromCloud(new Map(), ["p1"]), []);
  });

  test("accepts any iterable of present ids", () => {
    function* present() {
      yield "p1";
      yield "p2";
    }
    assert.deepEqual(missingFromCloud(owners, present()).map((m) => m.id), ["p3"]);
  });

  test("compares exactly, so callers must normalise first", () => {
    const azure = new Map([["wo-run-abc", owner("r1")]]);
    assert.equal(missingFromCloud(azure, ["WO-RUN-ABC"]).length, 1);
    assert.equal(missingFromCloud(azure, [normalizeId("azure", "WO-RUN-ABC")]).length, 0);
  });
});
