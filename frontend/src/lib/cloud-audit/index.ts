import "server-only";

import { auditAws } from "./aws";
import { auditAzure } from "./azure";
import { auditGcp } from "./gcp";
import { auditHarness } from "./harness";
import { resourceOwners } from "./owners";
import { AUDIT_TARGETS, type CloudAuditResult, type CloudStatusReport } from "./types";

export * from "./types";
export { billingAccountId } from "./gcp";

/**
 * Every audited platform, for the Cloud Status page.
 *
 * They run concurrently and answer independently: an AWS key that has been
 * rotated out, or an Azure subscription this deployment was never given, must not
 * cost the admin the Google Cloud answer. So each failure is data — a typed
 * `CloudAuditResult` the page explains in place — rather than an exception.
 *
 * The database is read once and the resulting owner maps are handed to all of
 * them, because each audit needs the same rows and there is no reason to ask four
 * times.
 */
export async function auditClouds(): Promise<CloudStatusReport> {
  const owners = await resourceOwners();

  const settled = await Promise.all(
    [auditGcp, auditAws, auditAzure, auditHarness].map(
      async (audit): Promise<CloudAuditResult> => {
        try {
          return await audit(owners);
        } catch {
          // Each audit already returns its own typed failures; this is the
          // backstop for anything unforeseen, so one target can't blank the page.
          return { ok: false, error: "unavailable" };
        }
      },
    ),
  );

  const [gcp, aws, azure, harness] = settled;
  return { gcp: gcp!, aws: aws!, azure: azure!, harness: harness! };
}

/** Whether a report has anything at all to show — used to pick the opening tab. */
export function firstConcern(report: CloudStatusReport) {
  // Whichever target has orphans is what the admin came for; failing that, the
  // first one that answered at all.
  return (
    AUDIT_TARGETS.find((t) => {
      const r = report[t];
      return r.ok && r.audit.counts.untracked > 0;
    }) ??
    AUDIT_TARGETS.find((t) => report[t].ok) ??
    "gcp"
  );
}
