/** Changes or removes one food order. */

import { NextResponse } from "next/server";
import { FOOD_ORDER_LIMITS } from "@/db/schema";
import { requireCaller } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { FORM_STATUS, deleteFoodOrder, readFoodOrderForm, updateFoodOrder } from "@/lib/logistics/food-orders";
import { canManageTrainingSettings } from "@/lib/roles";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = audited(async function PATCH(req: Request, { params }: Ctx) {
  const { error } = await requireCaller(req, canManageTrainingSettings);
  if (error) return error;

  if (Number(req.headers.get("content-length") ?? 0) > FOOD_ORDER_LIMITS.bytes + 64 * 1024) {
    return NextResponse.json({ error: "too_large" }, { status: 413 });
  }
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const read = await readFoodOrderForm(form);
  if (!read.ok) return NextResponse.json({ error: read.error }, { status: FORM_STATUS[read.error] });

  const { id } = await params;
  const order = await updateFoodOrder(id, read.fields, read.file);
  if (!order) return NextResponse.json({ error: "not_found" }, { status: 404 });
  noteAudit({ target: order.id, targetLabel: order.vendor });
  return NextResponse.json(order);
});

export const DELETE = audited(async function DELETE(req: Request, { params }: Ctx) {
  const { error } = await requireCaller(req, canManageTrainingSettings);
  if (error) return error;

  const { id } = await params;
  const vendor = await deleteFoodOrder(id);
  if (vendor === null) return NextResponse.json({ error: "not_found" }, { status: 404 });
  noteAudit({ target: id, targetLabel: vendor });
  return NextResponse.json({ ok: true });
});
