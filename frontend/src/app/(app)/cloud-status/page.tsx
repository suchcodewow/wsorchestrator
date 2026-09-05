import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { canAuditProjects } from "@/lib/roles";
import { auditClouds, firstConcern } from "@/lib/cloud-audit";
import { CloudStatus } from "./cloud-status-view";

export const metadata: Metadata = {
  title: "Cloud Status",
  robots: { index: false, follow: false },
};

/**
 * Cloud Status — the state of the platforms the workshops run on, one section
 * each for Google Cloud, AWS, Azure and Harness. Every isolation boundary the
 * deployment creates (a billed project, a member account, a resource group, a
 * Harness organization) matched against the runs table, so orphaned and
 * extraneous ones stand out.
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

  const report = await auditClouds();

  return <CloudStatus initial={report} opening={firstConcern(report)} />;
}
