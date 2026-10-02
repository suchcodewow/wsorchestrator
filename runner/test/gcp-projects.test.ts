/**
 * The rules that decide what the reaper may delete outright.
 *
 * A GCP teardown deletes the run's projects with one API call each, and the
 * run's GCP state with them, so these two functions are all that stand between
 * a wrong id and a deleted project. The cases are the real ones. Both sandbox
 * projects (`sbx-administration-459416`, `sbx-harnessevents-qa`) sit in their
 * environment's workshops folder labelled `managed_by=workshop-orchestrator`,
 * and must never be deleted. The challenge project is the one whose teardown
 * failed on 2026-09-15, which this change exists to fix.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  gcpStateObjects,
  projectDeleteRefusal,
  runLabel,
  type GcpProject,
} from "../src/gcp-projects.js";

const RUN = "3c6e6a7c-9b9d-4276-b4a5-b4b1866dbb4f";
const FOLDER = "522401695842";

const guard = {
  runId: RUN,
  folderId: FOLDER,
  adminProjectId: "administration-459416",
  sandboxProjectId: "sbx-administration-459416",
};

const challengeProject: GcpProject = {
  projectId: "ch-gcp-challenge-3c6e-f909b8",
  parent: `folders/${FOLDER}`,
  state: "ACTIVE",
  labels: { managed_by: "workshop-orchestrator", run_id: "3c6e6a7c9b9d" },
};

describe("runLabel", () => {
  test("is the label the project was stamped with", () => {
    assert.equal(runLabel(RUN), "3c6e6a7c9b9d");
  });
});

describe("projectDeleteRefusal", () => {
  test("allows the run's own project", () => {
    assert.equal(projectDeleteRefusal(challengeProject, guard), null);
  });

  test("allows it when already pending deletion", () => {
    assert.equal(
      projectDeleteRefusal({ ...challengeProject, state: "DELETE_REQUESTED" }, guard),
      null,
    );
  });

  test("refuses the sandbox, which shares the folder and managed_by label", () => {
    const sandbox: GcpProject = {
      projectId: "sbx-administration-459416",
      parent: `folders/${FOLDER}`,
      state: "ACTIVE",
      labels: {
        managed_by: "workshop-orchestrator",
        purpose: "shared-testing-sandbox",
      },
    };
    assert.match(projectDeleteRefusal(sandbox, guard) ?? "", /shared sandbox/);
    // Refused even where the sandbox is not configured, because it has no run_id.
    assert.match(
      projectDeleteRefusal(sandbox, { ...guard, sandboxProjectId: "" }) ?? "",
      /run_id=\(none\)/,
    );
  });

  test("refuses the admin project", () => {
    const admin: GcpProject = {
      projectId: "administration-459416",
      parent: "folders/123",
      state: "ACTIVE",
      labels: {},
    };
    assert.match(projectDeleteRefusal(admin, guard) ?? "", /admin project/);
  });

  test("refuses a project outside the workshops folder", () => {
    assert.match(
      projectDeleteRefusal({ ...challengeProject, parent: "folders/688190860371" }, guard) ?? "",
      /not the workshops folder/,
    );
  });

  test("refuses a project not labelled as the runner's", () => {
    assert.match(
      projectDeleteRefusal(
        { ...challengeProject, labels: { run_id: "3c6e6a7c9b9d" } },
        guard,
      ) ?? "",
      /managed_by/,
    );
  });

  test("refuses another run's project", () => {
    assert.match(
      projectDeleteRefusal(
        {
          ...challengeProject,
          labels: { managed_by: "workshop-orchestrator", run_id: "aaaaaaaaaaaa" },
        },
        guard,
      ) ?? "",
      /not this run's 3c6e6a7c9b9d/,
    );
  });
});

describe("gcpStateObjects", () => {
  const base = `workshops/${RUN}`;
  const all = [
    `${base}/default.tfstate`,
    `${base}/default.tflock`,
    `${base}/cluster/default.tfstate`,
    `${base}/delegate/gcp/default.tfstate`,
    `${base}/scenarios/gcp-connectivity-egress/default.tfstate`,
    `${base}/scenarios/gcp-connectivity-binauthz/default.tfstate`,
    `${base}/scenarios/gcp-delegate-blocked-manager/abc123/default.tfstate`,
    `${base}/scenarios/aws-connectivity-egress/default.tfstate`,
    `${base}/scenarios/azure-connectivity-egress/x/default.tfstate`,
    `${base}/aws/default.tfstate`,
    `${base}/aws/acct-1/default.tfstate`,
    `${base}/azure/cluster/default.tfstate`,
    `${base}/delegate/aws/default.tfstate`,
    `${base}0/default.tfstate`,
    `workshops/other-run/default.tfstate`,
  ];

  test("picks the GCP layers and nothing of AWS's, Azure's or another run's", () => {
    assert.deepEqual(gcpStateObjects(base, all), [
      `${base}/default.tfstate`,
      `${base}/default.tflock`,
      `${base}/cluster/default.tfstate`,
      `${base}/delegate/gcp/default.tfstate`,
      `${base}/scenarios/gcp-connectivity-egress/default.tfstate`,
      `${base}/scenarios/gcp-connectivity-binauthz/default.tfstate`,
      `${base}/scenarios/gcp-delegate-blocked-manager/abc123/default.tfstate`,
    ]);
  });

  test("treats a GCP scenario this build no longer ships as GCP's", () => {
    assert.deepEqual(
      gcpStateObjects(base, [`${base}/scenarios/gcp-retired-thing/default.tfstate`]),
      [`${base}/scenarios/gcp-retired-thing/default.tfstate`],
    );
  });
});
