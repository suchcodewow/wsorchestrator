/**
 * Ticking one checklist item done or back to do, which a Training
 * administrator or the item's owner can, and removing it, which only an
 * administrator can.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCaller } from "@/lib/api-auth";
import { audited } from "@/lib/audit";
import { canManageTrainingSettings } from "@/lib/roles";
import { CHECKLIST_STATUS_FOR, deleteChecklistItem, setChecklistItemDone } from "@/lib/scheduler/checklist";

const paramsSchema = z.object({ id: z.string().uuid(), itemId: z.string().uuid() });
const patchSchema = z.object({ done: z.boolean() });

type Params = { params: Promise<{ id: string; itemId: string }> };

export const PATCH = audited(async function PATCH(req: Request, { params }: Params) {
  // An owner may hold no Training role at all: a guest judge ticks theirs from the inbox.
  const { error, user } = await requireCaller(req);
  if (error) return error;

  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const body = patchSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const result = await setChecklistItemDone(
    { id: user.id, email: user.email, canManage: canManageTrainingSettings(user.access) },
    parsed.data.id,
    parsed.data.itemId,
    body.data.done,
  );
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: CHECKLIST_STATUS_FOR[result.error] });
  return NextResponse.json(result.value);
});

export const DELETE = audited(async function DELETE(req: Request, { params }: Params) {
  const { error } = await requireCaller(req, canManageTrainingSettings);
  if (error) return error;

  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const result = await deleteChecklistItem(parsed.data.id, parsed.data.itemId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: CHECKLIST_STATUS_FOR[result.error] });
  return NextResponse.json({ ok: true });
});
