import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { canAuditProjects } from "@/lib/roles";
import { auditClouds } from "@/lib/cloud-audit";

/** Signed in, and allowed to audit the deployment's clouds. */
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

/**
 * The cloud audit behind the page's Refresh button. Administrators only.
 *
 * Always 200 when the caller is allowed: each cloud carries its own ok/error, and
 * one cloud being unreachable is a thing to render, not a failed request. Only
 * auth says no here.
 */
export async function GET() {
  const { error } = await requireAdministrator();
  if (error) return error;

  return NextResponse.json({ report: await auditClouds() });
}
