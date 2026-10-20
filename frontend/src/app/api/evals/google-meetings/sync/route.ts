/**
 * The Google Meetings sync's log a page at a time; and syncing now, or with
 * `preview` logging whom it would invite and take off without doing it.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireEvalsAdministrator } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { getMeetingSyncLive, listMeetingSyncRuns, meetingSyncInProgress } from "@/lib/evals/google-meetings";
import { runMeetingSync, SYNC_STATUS_FOR } from "@/lib/evals/meeting-sync";
import { MEETING_SYNC_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";

// Each meeting is a few calls to Google, and to Zoom for one that is over.
export const maxDuration = 300;
const DEADLINE_MS = 270_000;

/** An empty body, or none, is a sync; `preview` makes it a dry run whether or not the sync is live. */
const bodySchema = z.object({ preview: z.boolean().optional() }).strict();

export async function GET(req: Request) {
  const { error } = await requireEvalsAdministrator(req);
  if (error) return error;

  const query = parseListQuery(new URL(req.url).searchParams, MEETING_SYNC_LIST);
  const [{ rows, page, hasMore }, running, live] = await Promise.all([
    listMeetingSyncRuns(query),
    meetingSyncInProgress(),
    getMeetingSyncLive(),
  ]);
  return NextResponse.json({ runs: rows, page, hasMore, running, live });
}

export const POST = audited(async function POST(req: Request) {
  const started = Date.now();
  const { error, user } = await requireEvalsAdministrator(req);
  if (error) return error;

  const text = await req.text();
  let parsed: z.SafeParseReturnType<unknown, z.infer<typeof bodySchema>>;
  try {
    parsed = bodySchema.safeParse(text.trim() ? JSON.parse(text) : {});
  } catch {
    parsed = bodySchema.safeParse(null);
  }
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const result = await runMeetingSync(user.id, started + DEADLINE_MS, { preview: parsed.data.preview === true });
  if (result.runId) noteAudit({ target: result.runId });
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, detail: result.detail, runId: result.runId },
      { status: SYNC_STATUS_FOR[result.error] },
    );
  }
  noteAudit({ detail: { ...result } });
  return NextResponse.json(result);
});
