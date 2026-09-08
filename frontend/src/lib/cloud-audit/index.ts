/** Audits every cloud for the Cloud Status page. */

import "server-only";

import { auditAws } from "./aws";
import { auditAzure } from "./azure";
import { auditGcp } from "./gcp";
import { auditHarness } from "./harness";
import { resourceOwners } from "./owners";
import { AUDIT_TARGETS, type CloudAuditResult, type CloudStatusReport } from "./types";

export * from "./types";
export { billingAccountId } from "./gcp";

export async function auditClouds(): Promise<CloudStatusReport> {
  const owners = await resourceOwners();

  const settled = await Promise.all(
    [auditGcp, auditAws, auditAzure, auditHarness].map(
      async (audit): Promise<CloudAuditResult> => {
        try {
          return await audit(owners);
        } catch {
          return { ok: false, error: "unavailable" };
        }
      },
    ),
  );

  const [gcp, aws, azure, harness] = settled;
  return { gcp: gcp!, aws: aws!, azure: azure!, harness: harness! };
}

export function firstConcern(report: CloudStatusReport) {
  return (
    AUDIT_TARGETS.find((t) => {
      const r = report[t];
      return r.ok && r.audit.counts.untracked > 0;
    }) ??
    AUDIT_TARGETS.find((t) => report[t].ok) ??
    "gcp"
  );
}
