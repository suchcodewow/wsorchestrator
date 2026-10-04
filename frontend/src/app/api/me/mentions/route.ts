/** The session comments that tag this account's email with "@", across every bootcamp, a page at a time. */

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { MY_MENTION_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { listMyMentions, myMentionCount } from "@/lib/scheduler/comments";

export async function GET(req: Request) {
  const { error, user } = await requireUser(req);
  if (error) return error;

  const [{ rows, page, hasMore }, total] = await Promise.all([
    listMyMentions(user.email, parseListQuery(new URL(req.url).searchParams, MY_MENTION_LIST)),
    myMentionCount(user.email),
  ]);
  return NextResponse.json({ mentions: rows, page, hasMore, total });
}
