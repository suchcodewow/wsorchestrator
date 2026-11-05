/**
 * Whether the Google Meetings sync changes Google Calendar invites and
 * cancels the old form's Zoom meetings (`live`), or only logs what it would
 * do. It starts as a dry run; QA, which shares production's Google
 * Workspace, leaves it there.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCaller } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { getMeetingSyncLive, setMeetingSyncLive } from "@/lib/evals/google-meetings";
import { canManageConnectors } from "@/lib/roles";

const bodySchema = z.object({ live: z.boolean() }).strict();

export async function GET(req: Request) {
  const { error } = await requireCaller(req, canManageConnectors);
  if (error) return error;
  return NextResponse.json({ live: await getMeetingSyncLive() });
}

export const PUT = audited(async function PUT(req: Request) {
  const { error, user } = await requireCaller(req, canManageConnectors);
  if (error) return error;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  await setMeetingSyncLive(user.id, parsed.data.live);
  noteAudit({ target: "google_meetings_mode", targetLabel: parsed.data.live ? "Live" : "Dry run" });
  return NextResponse.json({ live: await getMeetingSyncLive() });
});
