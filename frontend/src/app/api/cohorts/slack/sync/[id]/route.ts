/** One cohort Slack sync run, how many of its changes are of each kind, and a page of them. */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCaller } from "@/lib/api-auth";
import {
  countSlackSyncChanges,
  getSlackSyncRun,
  isSlackChangeKind,
  listSlackSyncChanges,
} from "@/lib/cohorts/slack-sync";
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

  const search = new URL(req.url).searchParams;
  const kind = search.get("kind");
  const [{ rows, page, hasMore }, counts] = await Promise.all([
    listSlackSyncChanges(run.id, parseListQuery(search, SLACK_SYNC_CHANGE_LIST), isSlackChangeKind(kind) ? kind : null),
    countSlackSyncChanges(run.id),
  ]);
  return NextResponse.json({ run, counts, changes: rows, page, hasMore });
}
