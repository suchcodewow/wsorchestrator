/** One cohort Slack sync run, and a page of what it did. */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCaller } from "@/lib/api-auth";
import { getSlackSyncRun, listSlackSyncChanges } from "@/lib/cohorts/slack-sync";
import { SLACK_SYNC_CHANGE_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { canManageTrainingSettings } from "@/lib/roles";

const idSchema = z.string().uuid();

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireCaller(req, canManageTrainingSettings);
  if (error) return error;

  const id = idSchema.safeParse((await params).id);
  const run = id.success ? await getSlackSyncRun(id.data) : null;
  if (!run) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const query = parseListQuery(new URL(req.url).searchParams, SLACK_SYNC_CHANGE_LIST);
  const { rows, page, hasMore } = await listSlackSyncChanges(run.id, query);
  return NextResponse.json({ run, changes: rows, page, hasMore });
}
