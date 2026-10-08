/** Mimir's content a page at a time, for anyone signed in; and making an item, for Training Administrators. */

import { NextResponse } from "next/server";
import { requireMimirAdministrator, requireUser } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { ITEM_STATUS_FOR, createItem, itemSchema, listItems } from "@/lib/mimir/items";
import { readItemFilter } from "@/lib/mimir/kinds";
import { MIMIR_ITEM_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";

export async function GET(req: Request) {
  const { error } = await requireUser(req);
  if (error) return error;

  const params = new URL(req.url).searchParams;
  const read = readItemFilter(params);
  if ("error" in read) return NextResponse.json({ error: read.error }, { status: 400 });

  const { rows, page, hasMore } = await listItems(parseListQuery(params, MIMIR_ITEM_LIST), read.filter);
  return NextResponse.json({ items: rows, page, hasMore });
}

export const POST = audited(async function POST(req: Request) {
  const { error, user } = await requireMimirAdministrator(req);
  if (error) return error;

  const parsed = itemSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const result = await createItem(user.id, parsed.data);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: ITEM_STATUS_FOR[result.error] });
  noteAudit({ target: result.id, targetLabel: result.title });
  return NextResponse.json({ id: result.id }, { status: 201 });
});
