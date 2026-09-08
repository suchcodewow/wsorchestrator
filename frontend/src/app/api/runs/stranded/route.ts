/** The events a restore to a given time would strand. */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { runsStrandedBy } from "@/lib/backups";
import { canManageBackups } from "@/lib/roles";

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
