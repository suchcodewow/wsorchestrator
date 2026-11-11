/**
 * Whether Google emails every guest about the Google Meetings sync's changes
 * to an invite (`email`), or the sync stays silent and a guest finds the
 * invite on their calendar. It starts silent.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCaller } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { getMeetingEmailInvites, setMeetingEmailInvites } from "@/lib/evals/google-meetings";
import { canManageConnectors } from "@/lib/roles";

const bodySchema = z.object({ email: z.boolean() }).strict();

export async function GET(req: Request) {
  const { error } = await requireCaller(req, canManageConnectors);
  if (error) return error;
  return NextResponse.json({ email: await getMeetingEmailInvites() });
}

export const PUT = audited(async function PUT(req: Request) {
  const { error, user } = await requireCaller(req, canManageConnectors);
  if (error) return error;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  await setMeetingEmailInvites(user.id, parsed.data.email);
  noteAudit({ target: "google_meetings_invites", targetLabel: parsed.data.email ? "Email Invites" : "Silent" });
  return NextResponse.json({ email: await getMeetingEmailInvites() });
});
