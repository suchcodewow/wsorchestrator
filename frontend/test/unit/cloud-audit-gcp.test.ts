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

import { auditGcp, billingAccountId } from "@/lib/cloud-audit/gcp";
import { ownerMaps, withCleanEnv } from "../support/cloud-audit";

withCleanEnv(["GCP_BILLING_ACCOUNT_ID"]);

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

describe("auditGcp", () => {
  test("is not_configured without a billing account", async () => {
    assert.deepEqual(await auditGcp(ownerMaps()), { ok: false, error: "not_configured" });
  });
});
