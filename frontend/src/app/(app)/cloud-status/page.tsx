/** The Cloud Status page. */

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { canAuditProjects } from "@/lib/roles";
import { auditClouds, firstConcern } from "@/lib/cloud-audit";
import { CloudStatus } from "./cloud-status-view";

export const metadata: Metadata = {
  title: "Cloud Status",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function CloudStatusPage() {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canAuditProjects(session.user.siteRole)) notFound();

  const report = await auditClouds();

  return <CloudStatus initial={report} opening={firstConcern(report)} />;
}
