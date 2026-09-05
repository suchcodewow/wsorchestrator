import "server-only";

import { CLOUDS } from "@/db/schema";
import { auditAws } from "./aws";
import { auditAzure } from "./azure";
import { auditGcp } from "./gcp";
import { resourceOwners } from "./owners";
import type { CloudAuditResult, CloudStatusReport } from "./types";

export * from "./types";
export { billingAccountId } from "./gcp";

/**
 * Every cloud's audit, for the Cloud Status page.
 *
 * The three run concurrently and answer independently: an AWS key that has been
 * rotated out, or an Azure subscription this deployment was never given, must not
 * cost the admin the Google Cloud answer. So each cloud's failure is data — a
 * typed `CloudAuditResult` the page explains in place — rather than an exception.
 *
 * The database is read once and the resulting owner maps are handed to all three,
 * because each audit needs the same rows and there is no reason to ask three
 * times.
 */
export async function auditClouds(): Promise<CloudStatusReport> {
  const owners = await resourceOwners();

  const settled = await Promise.all(
    [auditGcp, auditAws, auditAzure].map(async (audit): Promise<CloudAuditResult> => {
      try {
        return await audit(owners);
      } catch {
        // Each audit already returns its own typed failures; this is the
        // backstop for anything unforeseen, so one cloud can't blank the page.
        return { ok: false, error: "unavailable" };
      }
    }),
  );

  const [gcp, aws, azure] = settled;
  return { gcp: gcp!, aws: aws!, azure: azure! };
}

/** Whether a report has anything at all to show — used to pick the opening tab. */
export function firstConcern(report: CloudStatusReport) {
  const clouds = [...CLOUDS];
  // Whichever cloud has orphans is what the admin came for; failing that, the
  // first one that answered at all.
  return (
    clouds.find((c) => {
      const r = report[c];
      return r.ok && r.audit.counts.untracked > 0;
    }) ??
    clouds.find((c) => report[c].ok) ??
    "gcp"
  );
}
