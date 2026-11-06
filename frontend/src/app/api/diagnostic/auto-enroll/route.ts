/** Bootcamp Auto-Enroll: whether bootcamp attendees who have RSVP'd and are on a track are the Diagnostic's Participants. */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCaller } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { getAutoEnroll, participantCounts, setAutoEnroll } from "@/lib/iris/participants";
import { canManageIris } from "@/lib/roles";

const bodySchema = z.object({ on: z.boolean() });

export async function GET(req: Request) {
  const { error } = await requireCaller(req, canManageIris);
  if (error) return error;
  return NextResponse.json(await getAutoEnroll());
}

export const PUT = audited(async function PUT(req: Request) {
  const { error, user } = await requireCaller(req, canManageIris);
  if (error) return error;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  noteAudit({ targetLabel: parsed.data.on ? "Bootcamp Auto-Enroll on" : "Bootcamp Auto-Enroll off" });
  const autoEnroll = await setAutoEnroll(user.id, parsed.data.on);
  return NextResponse.json({ ...autoEnroll, counts: await participantCounts() });
});
