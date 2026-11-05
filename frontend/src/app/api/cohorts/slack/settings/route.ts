/**
 * The cohort Slack sync's daily intake form reminder (`reminders`), which
 * starts off. Whether Slack is live or a dry run is read here too, but set
 * on PUT /api/settings/slack-mode.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCaller } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { getSlackSyncLive } from "@/lib/cohorts/slack-sync";
import { getIntakeRemindersOn, setIntakeRemindersOn } from "@/lib/logistics/intake-reminders";
import { canManageTrainingSettings } from "@/lib/roles";

const bodySchema = z.object({ reminders: z.boolean() }).strict();

export async function GET(req: Request) {
  const { error } = await requireCaller(req, canManageTrainingSettings);
  if (error) return error;
  const [live, reminders] = await Promise.all([getSlackSyncLive(), getIntakeRemindersOn()]);
  return NextResponse.json({ live, reminders });
}

export const PUT = audited(async function PUT(req: Request) {
  const { error, user } = await requireCaller(req, canManageTrainingSettings);
  if (error) return error;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  await setIntakeRemindersOn(user.id, parsed.data.reminders);
  noteAudit({ target: "slack_settings", targetLabel: `Daily reminder ${parsed.data.reminders ? "on" : "off"}` });
  const [live, reminders] = await Promise.all([getSlackSyncLive(), getIntakeRemindersOn()]);
  return NextResponse.json({ live, reminders });
});
