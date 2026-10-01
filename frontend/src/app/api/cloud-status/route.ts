/** Re-runs the cloud audit behind the page's Refresh button. */

import { NextResponse } from "next/server";
import { sessionOrToken } from "@/lib/api-auth";
import { canAuditProjects } from "@/lib/roles";
import { auditClouds } from "@/lib/cloud-audit";

async function requireAdministrator(req: Request) {
  const caller = await sessionOrToken(req);
  if (!caller) {
    return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }
  if (!canAuditProjects(caller.access)) {
    return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }
  return { error: null };
}

export async function GET(req: Request) {
  const { error } = await requireAdministrator(req);
  if (error) return error;

  return NextResponse.json({ report: await auditClouds() });
}
