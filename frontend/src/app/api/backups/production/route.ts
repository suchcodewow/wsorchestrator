/** Lists production's backups, on a deployment that can import them (QA). */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { listProductionBackups, productionImportAvailable } from "@/lib/production-import";
import { canManageBackups } from "@/lib/roles";

const STATUS_FOR: Record<string, number> = {
  not_configured: 503,
  permission_denied: 502,
  unavailable: 502,
};

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!canManageBackups(session.user.access)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  // Production, and anywhere not set up for it, does not have this at all.
  if (!productionImportAvailable()) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const result = await listProductionBackups();
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: STATUS_FOR[result.error] ?? 502 },
    );
  }
  return NextResponse.json({ backups: result.backups });
}
