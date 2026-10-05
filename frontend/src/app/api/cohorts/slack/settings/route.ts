/**
 * Whether the cohort Slack sync changes Slack or only logs what it would do.
 * It starts in dry run; QA, which shares production's workspace, stays there.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCaller } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { getSlackSyncLive, setSlackSyncLive } from "@/lib/cohorts/slack-sync";
import { canManageTrainingSettings } from "@/lib/roles";

const bodySchema = z.object({ live: z.boolean() });

export async function GET(req: Request) {
  const { error } = await requireCaller(req, canManageTrainingSettings);
  if (error) return error;
  return NextResponse.json({ live: await getSlackSyncLive() });
}

export const PUT = audited(async function PUT(req: Request) {
  const { error, user } = await requireCaller(req, canManageTrainingSettings);
  if (error) return error;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  await setSlackSyncLive(user.id, parsed.data.live);
  noteAudit({ target: "slack_sync_live", targetLabel: parsed.data.live ? "Live" : "Dry run" });
  return NextResponse.json({ live: parsed.data.live });
});
