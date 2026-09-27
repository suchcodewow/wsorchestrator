/**
 * The scenarios an organizer can layer onto a challenge, and the one rule that
 * ties them together: anything that breaks a cluster needs the cluster.
 *
 * `withClusterScenario` runs in the picker *and* in the API, because a stored
 * selection that asks to break a cluster without building one describes a
 * challenge the runner cannot build — it would fail at apply time, in front of
 * competitors. These tests pin that the cluster is pulled in exactly when
 * something needs it, only for the cloud that needs it, and that the result
 * comes back in catalog order so the cluster sorts to the top.
 *
 * Drift from the Terraform manifests is guarded separately by
 * `runner/test/scenario-catalog.test.ts`; this file checks the catalog's own
 * internal consistency and the helpers.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { CLOUDS } from "@/db/schema";
import {
  SCENARIOS,
  clusterScenarioFor,
  clusterScenarioLocked,
  isScenarioId,
  needsClusterScenario,
  scenariosForCloud,
  scenariosForClouds,
  withClusterScenario,
} from "@/lib/scenario-catalog";

describe("SCENARIOS", () => {
  test("ids are unique and prefixed with their cloud", () => {
    const ids = SCENARIOS.map((s) => s.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const s of SCENARIOS) assert.ok(s.id.startsWith(`${s.cloud}-`), s.id);
  });

  test("every scenario belongs to a known cloud", () => {
    for (const s of SCENARIOS) assert.ok((CLOUDS as readonly string[]).includes(s.cloud), s.id);
  });

  test("each cloud has exactly one cluster scenario, listed first for that cloud", () => {
    for (const cloud of CLOUDS) {
      const list = scenariosForCloud(cloud);
      const clusters = list.filter((s) => "providesCluster" in s);
      assert.equal(clusters.length, 1, cloud);
      assert.equal(list[0], clusters[0], `${cloud}: the cluster is not first`);
    }
  });

  test("nothing both provides and requires a cluster", () => {
    for (const s of SCENARIOS) {
      assert.ok(!("providesCluster" in s && "requiresCluster" in s), s.id);
    }
  });

  test("every scenario has a label and a description", () => {
    for (const s of SCENARIOS) {
      assert.ok(s.label.trim().length > 0, s.id);
      assert.ok(s.description.trim().length > 0, s.id);
    }
  });
});

describe("lookups", () => {
  test("scenariosForCloud returns only that cloud's scenarios, in catalog order", () => {
    const gcp = scenariosForCloud("gcp");
    assert.ok(gcp.length > 0);
    assert.ok(gcp.every((s) => s.cloud === "gcp"));
    assert.deepEqual(
      gcp.map((s) => s.id),
      SCENARIOS.filter((s) => s.cloud === "gcp").map((s) => s.id),
    );
  });

  test("scenariosForClouds offers nothing until a cloud is picked", () => {
    assert.deepEqual(scenariosForClouds([]), []);
  });

  test("scenariosForClouds unions the clouds given", () => {
    assert.deepEqual(
      scenariosForClouds(["aws", "gcp"]).map((s) => s.id),
      SCENARIOS.filter((s) => s.cloud === "aws" || s.cloud === "gcp").map((s) => s.id),
    );
    assert.equal(scenariosForClouds([...CLOUDS]).length, SCENARIOS.length);
  });

  test("isScenarioId accepts catalog ids only, exactly", () => {
    for (const s of SCENARIOS) assert.equal(isScenarioId(s.id), true);
    for (const v of ["", "gcp", "GCP-CLUSTER", " gcp-cluster", "gcp-cluster ", "gcp-cluster-x"]) {
      assert.equal(isScenarioId(v), false, JSON.stringify(v));
    }
  });

  test("clusterScenarioFor names each cloud's cluster", () => {
    assert.equal(clusterScenarioFor("gcp")?.id, "gcp-cluster");
    assert.equal(clusterScenarioFor("aws")?.id, "aws-cluster");
    assert.equal(clusterScenarioFor("azure")?.id, "azure-cluster");
  });
});

describe("needsClusterScenario", () => {
  test("is true when something selected for that cloud needs a cluster", () => {
    assert.equal(needsClusterScenario(["gcp-connectivity-egress"], "gcp"), true);
  });

  test("is false for a selection on another cloud", () => {
    assert.equal(needsClusterScenario(["gcp-connectivity-egress"], "aws"), false);
  });

  test("is false for the cluster alone, an empty selection, or unknown ids", () => {
    assert.equal(needsClusterScenario(["gcp-cluster"], "gcp"), false);
    assert.equal(needsClusterScenario([], "gcp"), false);
    assert.equal(needsClusterScenario(["nonsense", "gcp-egress"], "gcp"), false);
  });
});

describe("withClusterScenario", () => {
  test("adds the cloud's cluster when a scenario needs it, and sorts it first", () => {
    assert.deepEqual(
      withClusterScenario(["gcp-delegate-blocked-manager", "gcp-connectivity-egress"], ["gcp"]),
      ["gcp-cluster", "gcp-connectivity-egress", "gcp-delegate-blocked-manager"],
    );
  });

  test("does not duplicate a cluster already selected", () => {
    assert.deepEqual(withClusterScenario(["gcp-connectivity-egress", "gcp-cluster"], ["gcp"]), [
      "gcp-cluster",
      "gcp-connectivity-egress",
    ]);
  });

  test("leaves a cluster-only selection alone, and an empty one empty", () => {
    assert.deepEqual(withClusterScenario(["aws-cluster"], ["aws"]), ["aws-cluster"]);
    assert.deepEqual(withClusterScenario([], ["aws"]), []);
  });

  test("only adds the cluster for clouds that are in the selection of clouds", () => {
    assert.deepEqual(withClusterScenario(["aws-connectivity-egress"], ["gcp"]), ["aws-connectivity-egress"]);
    assert.deepEqual(withClusterScenario(["aws-connectivity-egress"], []), ["aws-connectivity-egress"]);
  });

  test("handles several clouds at once", () => {
    assert.deepEqual(
      withClusterScenario(["azure-connectivity-egress", "aws-connectivity-egress"], ["aws", "azure"]),
      ["aws-cluster", "aws-connectivity-egress", "azure-cluster", "azure-connectivity-egress"],
    );
  });

  test("drops ids that are not in the catalog", () => {
    assert.deepEqual(withClusterScenario(["made-up", "gcp-connectivity-binauthz"], ["gcp"]), [
      "gcp-cluster",
      "gcp-connectivity-binauthz",
    ]);
  });

  test("is idempotent", () => {
    const once = withClusterScenario(["gcp-connectivity-binauthz", "aws-connectivity-egress"], [...CLOUDS]);
    assert.deepEqual(withClusterScenario(once, [...CLOUDS]), once);
  });
});

describe("clusterScenarioLocked", () => {
  test("locks the cluster while something depending on it is selected", () => {
    assert.equal(clusterScenarioLocked(["gcp-cluster", "gcp-connectivity-egress"], ["gcp"]), true);
  });

  test("does not lock it when only the cluster is selected, or the dependent is on another cloud", () => {
    assert.equal(clusterScenarioLocked(["gcp-cluster"], ["gcp"]), false);
    assert.equal(clusterScenarioLocked(["aws-connectivity-egress"], ["gcp"]), false);
    assert.equal(clusterScenarioLocked([], [...CLOUDS]), false);
  });
});
