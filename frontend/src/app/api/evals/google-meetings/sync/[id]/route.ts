/** One Google Meetings sync run, how many of its changes are of each kind, and a page of them. */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireEvalsAdministrator } from "@/lib/api-auth";
import {
  countMeetingSyncChanges,
  getMeetingSyncRun,
  isMeetingChangeKind,
  listMeetingSyncChanges,
} from "@/lib/evals/google-meetings";
import { MEETING_SYNC_CHANGE_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";

const idSchema = z.string().uuid();

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireEvalsAdministrator(req);
  if (error) return error;

  const id = idSchema.safeParse((await params).id);
  const run = id.success ? await getMeetingSyncRun(id.data) : null;
  if (!run) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const search = new URL(req.url).searchParams;
  const kind = search.get("kind");
  const [{ rows, page, hasMore }, counts] = await Promise.all([
    listMeetingSyncChanges(run.id, parseListQuery(search, MEETING_SYNC_CHANGE_LIST), isMeetingChangeKind(kind) ? kind : null),
    countMeetingSyncChanges(run.id),
  ]);
  return NextResponse.json({ run, counts, changes: rows, page, hasMore });
}
