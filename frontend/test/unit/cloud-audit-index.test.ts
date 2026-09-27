/**
 * Which cloud the Cloud Status page opens on.
 *
 * The page opens on the first cloud with something untracked on it — the
 * thing someone should look at — and otherwise on the first cloud that could
 * be audited at all, so nobody lands on an error tab when a working one
 * exists. `auditClouds` calls every provider and is not exercised here.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  firstConcern,
  type AuditTarget,
  type CloudAuditResult,
  type CloudStatusReport,
} from "@/lib/cloud-audit";

const ok = (target: AuditTarget, untracked = 0): CloudAuditResult => ({
  ok: true,
  audit: {
    target,
    scope: { label: "", value: "", name: null, url: null },
    columns: { id: "", name: "", state: "" },
    resources: [],
    missing: [],
    counts: { total: untracked, untracked, infra: 0, tracked: 0, unmanaged: 0 },
  },
});

const down: CloudAuditResult = { ok: false, error: "unavailable" };
const off: CloudAuditResult = { ok: false, error: "not_configured" };

const report = (r: Partial<CloudStatusReport>): CloudStatusReport => ({
  aws: off,
  azure: off,
  gcp: off,
  harness: off,
  ...r,
});

describe("firstConcern", () => {
  test("opens on the cloud with untracked resources", () => {
    assert.equal(firstConcern(report({ aws: ok("aws"), gcp: ok("gcp", 2), harness: ok("harness") })), "gcp");
  });

  test("with several, picks the first in tab order", () => {
    assert.equal(firstConcern(report({ azure: ok("azure", 1), harness: ok("harness", 5) })), "azure");
  });

  test("with nothing untracked, opens on the first cloud that was audited", () => {
    assert.equal(firstConcern(report({ aws: down, azure: ok("azure"), gcp: ok("gcp") })), "azure");
  });

  test("a failed audit is never the concern, whatever it says", () => {
    assert.equal(firstConcern(report({ aws: down, harness: ok("harness", 1) })), "harness");
  });

  test("falls back to gcp when nothing could be audited", () => {
    assert.equal(firstConcern(report({})), "gcp");
    assert.equal(firstConcern(report({ aws: down, azure: down, gcp: down, harness: down })), "gcp");
  });
});
