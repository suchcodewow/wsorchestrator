/** Switches one scheduled job on or off. */

import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { canManageTimedJobs } from "@/lib/roles";
import { setTimedJobEnabled } from "@/lib/timed-jobs";
import { timedJobDef } from "@/lib/timed-jobs-registry";

export const PATCH = audited(async function PATCH(
  req: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const { error, user } = await requireCaller(req, canManageTimedJobs);
  if (error) return error;

  const body = (await req.json().catch(() => null)) as { enabled?: unknown } | null;
  if (typeof body?.enabled !== "boolean") {
    return NextResponse.json({ error: "invalid_enabled" }, { status: 400 });
  }

  const { key } = await params;
  const job = timedJobDef(key);
  if (!job || !(await setTimedJobEnabled(user.id, key, body.enabled))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  noteAudit({ target: key, targetLabel: job.name, detail: { enabled: body.enabled } });
  return NextResponse.json({ ok: true });
});
