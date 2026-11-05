/** One release message run, how many of its rows are of each kind, and a page of who it messaged. */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCaller } from "@/lib/api-auth";
import { RELEASE_NOTICE_MESSAGE_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import {
  countReleaseNoticeMessages,
  getReleaseNotice,
  isReleaseNoticeKind,
  listReleaseNoticeMessages,
} from "@/lib/reporting/release-notice";
import { canManageBootcampRecords } from "@/lib/roles";

const idSchema = z.string().uuid();

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireCaller(req, canManageBootcampRecords);
  if (error) return error;

  const id = idSchema.safeParse((await params).id);
  const run = id.success ? await getReleaseNotice(id.data) : null;
  if (!run) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const search = new URL(req.url).searchParams;
  const kind = search.get("kind");
  const [{ rows, page, hasMore }, counts] = await Promise.all([
    listReleaseNoticeMessages(run.id, parseListQuery(search, RELEASE_NOTICE_MESSAGE_LIST), isReleaseNoticeKind(kind) ? kind : null),
    countReleaseNoticeMessages(run.id),
  ]);
  return NextResponse.json({ run, counts, messages: rows, page, hasMore });
}
