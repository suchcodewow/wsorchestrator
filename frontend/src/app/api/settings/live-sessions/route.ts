/** Whether a person's Live Sessions page shows its Diagnostic and Coach Canary sections. */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCaller } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { getLiveSessionsSettings, setLiveSessionsSettings } from "@/lib/reporting/live-sessions-settings";
import { canManageBootcampRecords } from "@/lib/roles";

const bodySchema = z.object({ diagnostic: z.boolean().optional(), coachCanary: z.boolean().optional() }).strict();

export async function GET(req: Request) {
  const { error } = await requireCaller(req, canManageBootcampRecords);
  if (error) return error;
  return NextResponse.json(await getLiveSessionsSettings());
}

export const PUT = audited(async function PUT(req: Request) {
  const { error, user } = await requireCaller(req, canManageBootcampRecords);
  if (error) return error;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  await setLiveSessionsSettings(user.id, parsed.data);
  const { diagnostic, coachCanary } = parsed.data;
  const parts = [
    diagnostic !== undefined && `Diagnostic ${diagnostic ? "on" : "off"}`,
    coachCanary !== undefined && `Coach Canary ${coachCanary ? "on" : "off"}`,
  ].filter(Boolean);
  noteAudit({ target: "live_sessions_settings", targetLabel: parts.join(", ") || "No change" });
  return NextResponse.json(await getLiveSessionsSettings());
});
