/**
 * Whether the app changes Slack and sends messages there (`live`), or only
 * logs what it would do: one switch for the cohort Slack sync and its
 * reminders, the daily survey announcements, the Live Sessions channels and
 * the release message. It starts as a dry run; QA, which shares production's
 * workspace, leaves it there.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCaller } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { getSlackSyncLive, setSlackSyncLive } from "@/lib/cohorts/slack-sync";
import { canManageConnectors } from "@/lib/roles";

const bodySchema = z.object({ live: z.boolean() }).strict();

export async function GET(req: Request) {
  const { error } = await requireCaller(req, canManageConnectors);
  if (error) return error;
  return NextResponse.json({ live: await getSlackSyncLive() });
}

export const PUT = audited(async function PUT(req: Request) {
  const { error, user } = await requireCaller(req, canManageConnectors);
  if (error) return error;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  await setSlackSyncLive(user.id, parsed.data.live);
  noteAudit({ target: "slack_mode", targetLabel: parsed.data.live ? "Live" : "Dry run" });
  return NextResponse.json({ live: await getSlackSyncLive() });
});
