/**
 * The Diagnostic's Slack reminders: their log a page at a time, with whether
 * they are live and who is due; and Remind Now, which runs them, or with
 * `preview` logs what it would send without sending it.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCaller } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import {
  REMINDER_STATUS_FOR,
  dueParticipants,
  getRemindersLive,
  listReminderRuns,
  reminderRunInProgress,
  remindersSentToday,
  runDiagnosticReminders,
} from "@/lib/iris/reminders";
import { IRIS_REMINDER_RUN_LIST } from "@/lib/list-specs";
import { appBase } from "@/lib/oauth-callback";
import { parseListQuery } from "@/lib/paging";
import { canManageIris } from "@/lib/roles";
import { slackToken } from "@/lib/slack";

// Looking up everyone due in Slack the first time is rate-limited.
export const maxDuration = 300;
const DEADLINE_MS = 270_000;

/** An empty body, or none, is a run; `preview` makes it a dry run whether or not reminders are live. */
const bodySchema = z.object({ preview: z.boolean().optional() }).strict();

export async function GET(req: Request) {
  const { error } = await requireCaller(req, canManageIris);
  if (error) return error;

  const query = parseListQuery(new URL(req.url).searchParams, IRIS_REMINDER_RUN_LIST);
  const [{ rows, page, hasMore }, running, live, sentToday, token, { assigned, due }] = await Promise.all([
    listReminderRuns(query),
    reminderRunInProgress(),
    getRemindersLive(),
    remindersSentToday(),
    slackToken(),
    dueParticipants(),
  ]);
  return NextResponse.json({
    runs: rows,
    page,
    hasMore,
    running,
    live,
    sentToday,
    configured: Boolean(token),
    assigned,
    due: due.length,
  });
}

export const POST = audited(async function POST(req: Request) {
  const started = Date.now();
  const { error, user } = await requireCaller(req, canManageIris);
  if (error) return error;

  const text = await req.text();
  let parsed: z.SafeParseReturnType<unknown, z.infer<typeof bodySchema>>;
  try {
    parsed = bodySchema.safeParse(text.trim() ? JSON.parse(text) : {});
  } catch {
    parsed = bodySchema.safeParse(null);
  }
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const result = await runDiagnosticReminders("manual", user.id, started + DEADLINE_MS, {
    preview: parsed.data.preview === true,
    appUrl: appBase(req),
  });
  if (result.runId) noteAudit({ target: result.runId });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, detail: result.detail, runId: result.runId },
      { status: REMINDER_STATUS_FOR[result.error] },
    );
  }
  noteAudit({ detail: { ...result } });
  return NextResponse.json(result);
});
