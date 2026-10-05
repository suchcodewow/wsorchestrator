/** The cohort Slack channel sync's log a page at a time, with the active bootcamp's channels; and syncing now. */

import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import {
  activeCohortChannels,
  getSlackSyncLive,
  listSlackSyncRuns,
  slackSyncInProgress,
  STATUS_FOR,
  syncSlackChannels,
} from "@/lib/cohorts/slack-sync";
import { SLACK_SYNC_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { canManageTrainingSettings } from "@/lib/roles";
import { slackToken } from "@/lib/slack";

// A first run looks up every email, and Slack rate-limits that.
export const maxDuration = 300;
const DEADLINE_MS = 270_000;

export async function GET(req: Request) {
  const { error } = await requireCaller(req, canManageTrainingSettings);
  if (error) return error;

  const query = parseListQuery(new URL(req.url).searchParams, SLACK_SYNC_LIST);
  const [{ rows, page, hasMore }, running, live, active] = await Promise.all([
    listSlackSyncRuns(query),
    slackSyncInProgress(),
    getSlackSyncLive(),
    activeCohortChannels(),
  ]);
  return NextResponse.json({
    runs: rows,
    page,
    hasMore,
    running,
    live,
    configured: Boolean(slackToken()),
    active,
  });
}

export const POST = audited(async function POST(req: Request) {
  const started = Date.now();
  const { error, user } = await requireCaller(req, canManageTrainingSettings);
  if (error) return error;

  const result = await syncSlackChannels("manual", user.id, started + DEADLINE_MS);
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
