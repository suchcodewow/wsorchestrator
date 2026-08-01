import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { runsStrandedBy } from "@/lib/backups";
import { canManageBackups } from "@/lib/roles";

/**
 * Events that would be stranded by restoring to `?since=<ISO time>`.
 *
 * Read by the restore confirmation dialog so the warning names actual events
 * rather than a hypothetical risk. Administrators only — it is the same
 * audience as the page, and it lists every user's events regardless of owner.
 *
 * A static segment under `/api/runs`, so it takes precedence over `[id]`; a
 * run can never have the id "stranded".
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!canManageBackups(session.user.siteRole)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const since = new URL(req.url).searchParams.get("since");
  const at = since ? new Date(since) : null;
  if (!at || Number.isNaN(at.getTime())) {
    return NextResponse.json({ error: "invalid_since" }, { status: 400 });
  }

  const runs = await runsStrandedBy(at);
  return NextResponse.json({
    runs: runs.map((r) => ({ id: r.id, name: r.name, status: r.status })),
  });
}
