/** The Sales, Engineer and Ignored title lists, a page at a time, and adding to them. */

import { NextResponse } from "next/server";
import { requireEvalsAdministrator } from "@/lib/api-auth";
import { addTitles, addTitlesSchema, listTitles } from "@/lib/evals/titles";
import { audited } from "@/lib/audit";
import { EVALS_TITLE_LISTS } from "@/db/schema";
import { TITLE_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";

export async function GET(req: Request) {
  const { error } = await requireEvalsAdministrator(req);
  if (error) return error;
  const params = new URL(req.url).searchParams;
  const asked = params.get("list");
  const list = EVALS_TITLE_LISTS.find((l) => l === asked);
  if (asked && !list) return NextResponse.json({ error: "invalid_list" }, { status: 400 });

  const { rows, page, hasMore } = await listTitles({ ...parseListQuery(params, TITLE_LIST), list });
  return NextResponse.json({ titles: rows, page, hasMore });
}

export const POST = audited(async function POST(req: Request) {
  const { error, user } = await requireEvalsAdministrator(req);
  if (error) return error;

  const parsed = addTitlesSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  const result = await addTitles(user.id, parsed.data.list, parsed.data.titles);
  return NextResponse.json(result);
});
