/** One Mimir item: reading it, for anyone signed in; replacing or removing it, for Training Administrators. */

import { NextResponse } from "next/server";
import { requireMimirAdministrator, requireUser } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { ITEM_STATUS_FOR, deleteItem, getItem, itemSchema, updateItem } from "@/lib/mimir/items";
import { coachModeOf } from "@/lib/mimir/kinds";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  const { error } = await requireUser(req);
  if (error) return error;

  const found = await getItem((await params).id);
  if (!found) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ...found, coach: coachModeOf(found.item.kind) });
}

export const PUT = audited(async function PUT(req: Request, { params }: Params) {
  const { error, user } = await requireMimirAdministrator(req);
  if (error) return error;

  const parsed = itemSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const result = await updateItem(user.id, (await params).id, parsed.data);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: ITEM_STATUS_FOR[result.error] });
  noteAudit({ target: result.id, targetLabel: result.title });
  return NextResponse.json({ ok: true });
});

export const DELETE = audited(async function DELETE(req: Request, { params }: Params) {
  const { error } = await requireMimirAdministrator(req);
  if (error) return error;

  const id = (await params).id;
  const result = await deleteItem(id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: ITEM_STATUS_FOR[result.error] });
  noteAudit({ target: id, targetLabel: result.title });
  return NextResponse.json({ ok: true });
});
