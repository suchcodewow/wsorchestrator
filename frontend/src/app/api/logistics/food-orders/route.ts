/** Food orders, a page at a time, and adding one with its PDF. */

import { NextResponse } from "next/server";
import { FOOD_ORDER_LIMITS } from "@/db/schema";
import { requireCaller } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { FOOD_ORDER_LIST } from "@/lib/list-specs";
import { FORM_STATUS, createFoodOrder, listFoodOrders, readFoodOrderForm } from "@/lib/logistics/food-orders";
import { parseListQuery } from "@/lib/paging";
import { canManageTrainingSettings, canUseTraining } from "@/lib/roles";

export async function GET(req: Request) {
  const { error } = await requireCaller(req, canUseTraining);
  if (error) return error;

  const { rows, page, hasMore } = await listFoodOrders(parseListQuery(new URL(req.url).searchParams, FOOD_ORDER_LIST));
  return NextResponse.json({ orders: rows, page, hasMore });
}

export const POST = audited(async function POST(req: Request) {
  const { error, user } = await requireCaller(req, canManageTrainingSettings);
  if (error) return error;

  if (Number(req.headers.get("content-length") ?? 0) > FOOD_ORDER_LIMITS.bytes + 64 * 1024) {
    return NextResponse.json({ error: "too_large" }, { status: 413 });
  }
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const read = await readFoodOrderForm(form);
  if (!read.ok) return NextResponse.json({ error: read.error }, { status: FORM_STATUS[read.error] });

  const order = await createFoodOrder(user.id, read.fields, read.file);
  noteAudit({ target: order.id, targetLabel: order.vendor });
  return NextResponse.json(order, { status: 201 });
});
