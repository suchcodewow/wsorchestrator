/**
 * Ticking one checklist item done or back to do, which a Training
 * administrator or the item's owner can, and changing its name or owner,
 * moving it to another half-day, or removing it, which only an administrator can.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCaller } from "@/lib/api-auth";
import { audited } from "@/lib/audit";
import { canManageTrainingSettings } from "@/lib/roles";
import {
  CHECKLIST_STATUS_FOR,
  checklistEditSchema,
  deleteChecklistItem,
  editChecklistItem,
  moveChecklistItem,
  setChecklistItemDone,
} from "@/lib/scheduler/checklist";

const paramsSchema = z.object({ id: z.string().uuid(), itemId: z.string().uuid() });
const patchSchema = checklistEditSchema
  .extend({ done: z.boolean().optional() })
  .refine((b) => [b.done, b.name, b.ownerEmail, b.track, b.day, b.period].some((v) => v !== undefined));

type Params = { params: Promise<{ id: string; itemId: string }> };

export const PATCH = audited(async function PATCH(req: Request, { params }: Params) {
  // An owner may hold no Training role at all: a guest judge ticks theirs from the inbox.
  const { error, user } = await requireCaller(req);
  if (error) return error;

  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const body = patchSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const canManage = canManageTrainingSettings(user.access);
  const { done, track, day, period, ...edit } = body.data;
  const editing = edit.name !== undefined || edit.ownerEmail !== undefined;
  const moving = track !== undefined || day !== undefined || period !== undefined;
  if ((editing || moving) && !canManage) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  // Each step in turn, stopping at the first that fails: the name and owner, then where it is, then whether it is done.
  const { id, itemId } = parsed.data;
  const steps = [
    editing && (() => editChecklistItem(user.id, id, itemId, edit)),
    moving && (() => moveChecklistItem(id, itemId, { track, day, period })),
    done !== undefined && (() => setChecklistItemDone({ id: user.id, email: user.email, canManage }, id, itemId, done)),
  ].filter((s) => s !== false);
  let result = await steps[0]!();
  for (const step of steps.slice(1)) {
    if (!result.ok) break;
    result = await step();
  }
  if (!result.ok) {
    return NextResponse.json(result.email ? { error: result.error, email: result.email } : { error: result.error }, {
      status: CHECKLIST_STATUS_FOR[result.error],
    });
  }
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
