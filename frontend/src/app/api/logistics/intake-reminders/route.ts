/**
 * The intake form's daily Slack reminders: whether they are on, how many are
 * still to answer, and the last run that set out to send them (GET), and
 * turning them on or off (PUT). They are sent by the cohort Slack sync; see
 * `lib/logistics/intake-reminders.ts`.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCaller } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { getSlackSyncLive, lastReminderRun } from "@/lib/cohorts/slack-sync";
import {
  getIntakeRemindersOn,
  intakeReminderSlack,
  intakeRemindersSentToday,
  outstandingIntake,
  setIntakeRemindersOn,
} from "@/lib/logistics/intake-reminders";
import { canManageTrainingSettings } from "@/lib/roles";

const bodySchema = z.object({ on: z.boolean() }).strict();

export async function GET(req: Request) {
  const { error } = await requireCaller(req, canManageTrainingSettings);
  if (error) return error;

  const [on, live, sentToday, lastRun, { counts }, slack] = await Promise.all([
    getIntakeRemindersOn(),
    getSlackSyncLive(),
    intakeRemindersSentToday(),
    lastReminderRun(),
    outstandingIntake(),
    intakeReminderSlack(),
  ]);
  return NextResponse.json({ on, live, sentToday, lastRun, counts, slack });
}

export const PUT = audited(async function PUT(req: Request) {
  const { error, user } = await requireCaller(req, canManageTrainingSettings);
  if (error) return error;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  await setIntakeRemindersOn(user.id, parsed.data.on);
  noteAudit({ target: "intake_reminders_on", targetLabel: parsed.data.on ? "Intake reminders on" : "Intake reminders off" });
  return NextResponse.json({ on: parsed.data.on });
});
