/**
 * Switches one timed job on or off, sets when it runs, or both. Only the
 * app's own jobs, which the dispatcher starts, take a schedule; the reaper's
 * and the scheduler's are set in Terraform.
 */

import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { canManageTimedJobs } from "@/lib/roles";
import { setTimedJobEnabled, setTimedJobSchedule } from "@/lib/timed-jobs";
import { timedJobDef } from "@/lib/timed-jobs-registry";

type Schedule = { cron: string; timeZone: string } | null;

function readSchedule(value: unknown): Schedule | undefined {
  if (value === null) return null;
  if (typeof value !== "object") return undefined;
  const { cron, timeZone, ...rest } = value as Record<string, unknown>;
  if (typeof cron !== "string" || typeof timeZone !== "string" || Object.keys(rest).length > 0) return undefined;
  return { cron, timeZone };
}

export const PATCH = audited(async function PATCH(
  req: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const { error, user } = await requireCaller(req, canManageTimedJobs);
  if (error) return error;

  const body = (await req.json().catch(() => null)) as { enabled?: unknown; schedule?: unknown } | null;
  const hasEnabled = body !== null && "enabled" in body;
  const hasSchedule = body !== null && "schedule" in body;
  if ((!hasEnabled && !hasSchedule) || (hasEnabled && typeof body.enabled !== "boolean")) {
    return NextResponse.json({ error: "invalid_enabled" }, { status: 400 });
  }
  const schedule = hasSchedule ? readSchedule(body.schedule) : undefined;
  if (hasSchedule && schedule === undefined) {
    return NextResponse.json({ error: "invalid_schedule", detail: "A schedule is { cron, timeZone }, or null for the default" }, { status: 400 });
  }

  const { key } = await params;
  const job = timedJobDef(key);
  if (!job) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (schedule !== undefined) {
    const result = await setTimedJobSchedule(user.id, key, schedule);
    if (!result.ok) {
      const status = result.error === "not_found" ? 404 : result.error === "fixed_schedule" ? 409 : 400;
      return NextResponse.json(result.error === "invalid_schedule" ? { error: result.error, detail: result.detail } : { error: result.error }, { status });
    }
  }
  if (hasEnabled) await setTimedJobEnabled(user.id, key, body.enabled as boolean);

  noteAudit({
    target: key,
    targetLabel: job.name,
    detail: { ...(hasEnabled ? { enabled: body.enabled } : {}), ...(schedule !== undefined ? { schedule } : {}) },
  });
  return NextResponse.json({ ok: true });
});
