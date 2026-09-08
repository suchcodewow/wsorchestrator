/** Re-runs the cloud audit behind the page's Refresh button. */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { canAuditProjects } from "@/lib/roles";
import { auditClouds } from "@/lib/cloud-audit";

async function requireAdministrator() {
  const session = await auth();
  if (!session?.user) {
    return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }
  if (!canAuditProjects(session.user.siteRole)) {
    return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }
  return { error: null };
}

export async function GET() {
  const { error } = await requireAdministrator();
  if (error) return error;

  return NextResponse.json({ report: await auditClouds() });
}
