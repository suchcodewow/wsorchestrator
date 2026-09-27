/**
 * What the person deploying ticked, and the record of what went in.
 *
 * `nothingSelected` is what stops an empty deploy before an organization is
 * created for nothing. `mergeDeployed` is the record a second deploy into the
 * same organization leaves: that deploy adds to what is there rather than
 * replacing it, so the record has to be the union of both runs — a flag once
 * true stays true, and a template source copied twice is listed once. A record
 * that forgot the first run would tell the next person the org holds less than
 * it does.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  mergeDeployed,
  nothingDeployed,
  nothingSelected,
  type DeployedContent,
} from "@/lib/harness-deploy-selection";

const none: DeployedContent = { official: false, mySecrets: false, myTemplates: [] };

describe("nothingSelected", () => {
  test("is true only when nothing at all is ticked", () => {
    assert.equal(nothingSelected({ official: false, mySecrets: false, myTemplates: [] }), true);
  });

  test("is false when any one thing is ticked", () => {
    assert.equal(nothingSelected({ official: true, mySecrets: false, myTemplates: [] }), false);
    assert.equal(nothingSelected({ official: false, mySecrets: true, myTemplates: [] }), false);
    assert.equal(nothingSelected({ official: false, mySecrets: false, myTemplates: ["t1"] }), false);
  });
});

describe("nothingDeployed", () => {
  test("is true only for an empty record", () => {
    assert.equal(nothingDeployed(none), true);
    assert.equal(nothingDeployed({ ...none, official: true }), false);
    assert.equal(nothingDeployed({ ...none, mySecrets: true }), false);
    assert.equal(nothingDeployed({ ...none, myTemplates: ["Platform templates"] }), false);
  });
});

describe("mergeDeployed", () => {
  test("with no earlier record, is the current run", () => {
    const now = { official: true, mySecrets: false, myTemplates: ["A", "B"] };
    assert.deepEqual(mergeDeployed(null, now), now);
  });

  test("keeps a flag set by the earlier run even when this run left it off", () => {
    const merged = mergeDeployed(
      { official: true, mySecrets: true, myTemplates: [] },
      { official: false, mySecrets: false, myTemplates: [] },
    );
    assert.equal(merged.official, true);
    assert.equal(merged.mySecrets, true);
  });

  test("sets a flag this run turned on", () => {
    const merged = mergeDeployed(none, { official: false, mySecrets: true, myTemplates: [] });
    assert.deepEqual(merged, { official: false, mySecrets: true, myTemplates: [] });
  });

  test("lists template sources from both runs once each, earlier ones first", () => {
    const merged = mergeDeployed(
      { ...none, myTemplates: ["A", "B"] },
      { ...none, myTemplates: ["B", "C", "A", "D"] },
    );
    assert.deepEqual(merged.myTemplates, ["A", "B", "C", "D"]);
  });

  test("collapses a name repeated within one run", () => {
    assert.deepEqual(mergeDeployed(null, { ...none, myTemplates: ["A", "A"] }).myTemplates, ["A"]);
  });

  test("treats names as exact strings, so differently cased names stay distinct", () => {
    // They are recorded as they read at the time; two sources can differ only
    // in case, and folding them would lose one.
    assert.deepEqual(
      mergeDeployed({ ...none, myTemplates: ["Demo"] }, { ...none, myTemplates: ["demo"] }).myTemplates,
      ["Demo", "demo"],
    );
  });

  test("does not modify either record", () => {
    const earlier = { official: true, mySecrets: false, myTemplates: ["A"] };
    const now = { official: false, mySecrets: true, myTemplates: ["B"] };
    const merged = mergeDeployed(earlier, now);
    assert.deepEqual(earlier, { official: true, mySecrets: false, myTemplates: ["A"] });
    assert.deepEqual(now, { official: false, mySecrets: true, myTemplates: ["B"] });
    assert.notEqual(merged.myTemplates, earlier.myTemplates);
    assert.notEqual(merged.myTemplates, now.myTemplates);
  });

  test("merging two empty records records nothing", () => {
    assert.equal(nothingDeployed(mergeDeployed(none, none)), true);
    assert.equal(nothingDeployed(mergeDeployed(null, none)), true);
  });
});
