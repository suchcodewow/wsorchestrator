import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { canAuditProjects } from "@/lib/roles";
import { auditBillingProjects } from "@/lib/projects-audit";
import { CloudStatus } from "./cloud-status-view";

export const metadata: Metadata = {
  title: "Cloud Status",
  robots: { index: false, follow: false },
};

/**
 * Cloud Status — the state of the clouds the workshops run on. Today that is
 * Google Cloud: every project billed to the workshop account, matched against
 * the runs table so orphaned and extraneous projects stand out. AWS and Azure
 * will get their own sections here as those clouds go to production.
 *
 * Administrators only; a 404 for anyone below, the same as the other admin
 * pages. Fetched fresh on every load (no cache): a stale answer to "is anything
 * billed that shouldn't be?" is worse than making the admin wait a beat.
 */
export const dynamic = "force-dynamic";

export default async function CloudStatusPage() {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  if (!canAuditProjects(session.user.siteRole)) notFound();

  const result = await auditBillingProjects();

  return (
    <CloudStatus
      initial={result.ok ? result.audit : null}
      error={result.ok ? null : result.error}
    />
  );
}
