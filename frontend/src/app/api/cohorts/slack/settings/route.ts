/**
 * The cohort Slack sync's two switches: whether it changes Slack or only logs
 * what it would do (`live`), and whether it sends the intake form's daily
 * reminder (`reminders`). Both start off; QA, which shares production's
 * workspace, leaves them there.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCaller } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { getSlackSyncLive, setSlackSyncLive } from "@/lib/cohorts/slack-sync";
import { getIntakeRemindersOn, setIntakeRemindersOn } from "@/lib/logistics/intake-reminders";
import { canManageTrainingSettings } from "@/lib/roles";

const bodySchema = z
  .object({ live: z.boolean().optional(), reminders: z.boolean().optional() })
  .strict()
  .refine((b) => b.live !== undefined || b.reminders !== undefined, "nothing to change");

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
  const { live, reminders } = parsed.data;
  if (live !== undefined) await setSlackSyncLive(user.id, live);
  if (reminders !== undefined) await setIntakeRemindersOn(user.id, reminders);
  noteAudit({
    target: "slack_settings",
    targetLabel: [
      live !== undefined && (live ? "Live" : "Dry run"),
      reminders !== undefined && `Daily reminder ${reminders ? "on" : "off"}`,
    ]
      .filter(Boolean)
      .join(", "),
  });
  const [nowLive, nowReminders] = await Promise.all([getSlackSyncLive(), getIntakeRemindersOn()]);
  return NextResponse.json({ live: nowLive, reminders: nowReminders });
});
