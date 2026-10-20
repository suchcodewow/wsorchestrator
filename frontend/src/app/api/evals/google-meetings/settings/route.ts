/**
 * Whether the Google Meetings sync changes the calendar or only logs what it
 * would do (`live`). It starts off; QA, which shares production's Google
 * Workspace, leaves it there.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireEvalsAdministrator } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { getMeetingSyncLive, setMeetingSyncLive } from "@/lib/evals/google-meetings";

const bodySchema = z.object({ live: z.boolean() }).strict();

export async function GET(req: Request) {
  const { error } = await requireEvalsAdministrator(req);
  if (error) return error;
  return NextResponse.json({ live: await getMeetingSyncLive() });
}

export const PUT = audited(async function PUT(req: Request) {
  const { error, user } = await requireEvalsAdministrator(req);
  if (error) return error;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  await setMeetingSyncLive(user.id, parsed.data.live);
  noteAudit({ target: "google_meetings_settings", targetLabel: parsed.data.live ? "Live" : "Dry run" });
  return NextResponse.json({ live: await getMeetingSyncLive() });
});
