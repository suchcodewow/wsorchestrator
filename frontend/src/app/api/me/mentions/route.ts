/** Everywhere this account's email is tagged with "@", across every bootcamp, a page at a time. */

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api-auth";
import { MY_MENTION_LIST } from "@/lib/list-specs";
import { listMyMentions, myMentionCount } from "@/lib/mention-store";
import { parseListQuery } from "@/lib/paging";

export async function GET(req: Request) {
  const { error, user } = await requireUser(req);
  if (error) return error;

  const viewer = { email: user.email, access: user.access };
  const [{ rows, page, hasMore }, total] = await Promise.all([
    listMyMentions(viewer, parseListQuery(new URL(req.url).searchParams, MY_MENTION_LIST)),
    myMentionCount(viewer),
  ]);
  return NextResponse.json({ mentions: rows, page, hasMore, total });
}
