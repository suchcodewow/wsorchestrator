/**
 * The cohort Slack sync's log a page at a time, with the active bootcamp's
 * channels; and syncing now, which also sends the intake form reminders that
 * are due, or with `preview` logs what it would do and send without doing it.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCaller } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import {
  activeCohortChannels,
  getSlackSyncLive,
  listSlackSyncRuns,
  slackSyncInProgress,
  STATUS_FOR,
  runSlackSync,
} from "@/lib/cohorts/slack-sync";
import { SLACK_SYNC_LIST } from "@/lib/list-specs";
import { getIntakeRemindersOn, intakeRemindersSentToday, outstandingIntake } from "@/lib/logistics/intake-reminders";
import { appBase } from "@/lib/oauth-callback";
import { parseListQuery } from "@/lib/paging";
import { canManageTrainingSettings } from "@/lib/roles";
import { slackToken } from "@/lib/slack";

// A first run looks up every email, and Slack rate-limits that.
export const maxDuration = 300;
const DEADLINE_MS = 270_000;

/** An empty body, or none, is a sync; `preview` makes it a dry run whether or not the sync is live. */
const bodySchema = z.object({ preview: z.boolean().optional() }).strict();

export async function GET(req: Request) {
  const { error } = await requireCaller(req, canManageTrainingSettings);
  if (error) return error;

  const query = parseListQuery(new URL(req.url).searchParams, SLACK_SYNC_LIST);
  const [{ rows, page, hasMore }, running, live, active, token, remindersOn, sentToday, { counts }] = await Promise.all([
    listSlackSyncRuns(query),
    slackSyncInProgress(),
    getSlackSyncLive(),
    activeCohortChannels(),
    slackToken(),
    getIntakeRemindersOn(),
    intakeRemindersSentToday(),
    outstandingIntake(),
  ]);
  return NextResponse.json({
    runs: rows,
    page,
    hasMore,
    running,
    live,
    configured: Boolean(token),
    active,
    reminders: { on: remindersOn, sentToday, counts },
  });
}

export const POST = audited(async function POST(req: Request) {
  const started = Date.now();
  const { error, user } = await requireCaller(req, canManageTrainingSettings);
  if (error) return error;

  const text = await req.text();
  let parsed: z.SafeParseReturnType<unknown, z.infer<typeof bodySchema>>;
  try {
    parsed = bodySchema.safeParse(text.trim() ? JSON.parse(text) : {});
  } catch {
    parsed = bodySchema.safeParse(null);
  }
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const result = await runSlackSync("manual", user.id, started + DEADLINE_MS, {
    preview: parsed.data.preview === true,
    appUrl: appBase(req),
  });
  if (result.runId) noteAudit({ target: result.runId });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, detail: result.detail, runId: result.runId },
      { status: STATUS_FOR[result.error] },
    );
  }
  noteAudit({ detail: { ...result } });
  return NextResponse.json(result);
});
