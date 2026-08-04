import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { canAuditProjects } from "@/lib/roles";
import { auditBillingProjects, type AuditUnavailable } from "@/lib/projects-audit";

/** Signed in, and allowed to audit the billing account's projects. */
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

const STATUS_FOR: Record<AuditUnavailable, number> = {
  not_configured: 503,
  permission_denied: 502,
  unavailable: 502,
};

/** The billing-account project audit. Administrators only. */
export async function GET() {
  const { error } = await requireAdministrator();
  if (error) return error;

  const result = await auditBillingProjects();
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: STATUS_FOR[result.error] },
    );
  }
  return NextResponse.json({ audit: result.audit });
}
