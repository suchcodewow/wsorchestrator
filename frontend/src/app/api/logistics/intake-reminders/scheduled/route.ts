/**
 * The intake form's daily Slack reminders, called by Cloud Scheduler once a
 * day (infra/admin/scheduler.tf). A run of the cohort Slack sync that sends
 * only the reminders, logged on Cohort Settings → Slack, and a dry run while
 * the sync is. Starts no run at all while the daily reminder is off on
 * Cohort Settings → Slack, or once today's have gone out.
 *
 * Only a Google-signed OIDC token with `INTAKE_REMINDERS_AUDIENCE` from
 * `INTAKE_REMINDERS_INVOKER` is accepted; either unset refuses every call.
 */

import { NextResponse } from "next/server";
import { audited, noteAudit } from "@/lib/audit";
import { STATUS_FOR, runSlackSync } from "@/lib/cohorts/slack-sync";
import { getIntakeRemindersOn, intakeRemindersSentToday } from "@/lib/logistics/intake-reminders";
import { appBase } from "@/lib/oauth-callback";
import { fromInvoker } from "@/lib/oidc-caller";

// Cloud Scheduler's attempt_deadline (infra/admin/scheduler.tf) is the same.
export const maxDuration = 300;

/** When the run must stop by, leaving time to log it and answer. */
const DEADLINE_MS = 270_000;

export const POST = audited(async function POST(req: Request) {
  const started = Date.now();
  if (!(await fromInvoker(req, process.env.INTAKE_REMINDERS_AUDIENCE, process.env.INTAKE_REMINDERS_INVOKER))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!(await getIntakeRemindersOn())) return NextResponse.json({ skipped: "off" });
  if (await intakeRemindersSentToday()) return NextResponse.json({ skipped: "already_sent" });

  const result = await runSlackSync("schedule", null, started + DEADLINE_MS, { scope: "reminders", appUrl: appBase(req) });
  if (result.runId) noteAudit({ target: result.runId, targetLabel: "Intake reminders", detail: { ...result } });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, detail: result.detail, runId: result.runId },
      { status: STATUS_FOR[result.error] },
    );
  }
  return NextResponse.json(result);
});
