/**
 * The GCP audit's configuration check.
 *
 * GCP is audited through the billing account: every project billed to it is a
 * project costing money. Without `GCP_BILLING_ACCOUNT_ID` there is nothing to
 * list, and the audit must say `not_configured` rather than try to build
 * Google credentials. The listing itself goes through `google-auth-library`
 * rather than `fetch`, so it is not exercised here.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  auditGcp,
  billingAccountId,
  infraProjectIds,
  isUnmanagedProject,
} from "@/lib/cloud-audit/gcp";
import { ownerMaps, withCleanEnv } from "../support/cloud-audit";

withCleanEnv([
  "GCP_BILLING_ACCOUNT_ID",
  "GCP_ADMIN_PROJECT_ID",
  "GCP_SANDBOX_PROJECT_ID",
  "GCP_INFRA_PROJECT_IDS",
]);

describe("infraProjectIds", () => {
  test("is empty when nothing is configured", () => {
    assert.deepEqual([...infraProjectIds()], []);
  });

  test("unions the admin and sandbox projects with the listed ones", () => {
    process.env.GCP_ADMIN_PROJECT_ID = "admin-project";
    process.env.GCP_SANDBOX_PROJECT_ID = "sbx-admin-project";
    process.env.GCP_INFRA_PROJECT_IDS = " other-admin , sbx-other-admin,,admin-project ";
    assert.deepEqual(
      [...infraProjectIds()].sort(),
      ["admin-project", "other-admin", "sbx-admin-project", "sbx-other-admin"],
    );
  });
});

describe("billingAccountId", () => {
  test("is null when unset or empty", () => {
    assert.equal(billingAccountId(), null);
    process.env.GCP_BILLING_ACCOUNT_ID = "";
    assert.equal(billingAccountId(), null);
  });

  test("is the configured account", () => {
    process.env.GCP_BILLING_ACCOUNT_ID = "012345-6789AB-CDEF01";
    assert.equal(billingAccountId(), "012345-6789AB-CDEF01");
  });
});

describe("isUnmanagedProject", () => {
  test("is another team's event- project", () => {
    assert.equal(isUnmanagedProject("event-summit-2026"), true);
  });

  test("is not one of the runner's own", () => {
    for (const id of ["ws-build-software-3c6e6a", "ch-gcp-challenge-3c6e-f909b8", "sbx-harnessevents-qa", "my-event-x"]) {
      assert.equal(isUnmanagedProject(id), false, id);
    }
  });
});

describe("auditGcp", () => {
  test("is not_configured without a billing account", async () => {
    assert.deepEqual(await auditGcp(ownerMaps()), { ok: false, error: "not_configured" });
  });
});
