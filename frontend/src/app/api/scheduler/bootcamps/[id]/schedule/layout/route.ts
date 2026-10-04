/** Saving the order and length of the sessions on the track-days that changed. */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCaller } from "@/lib/api-auth";
import { audited } from "@/lib/audit";
import { canManageTrainingSettings } from "@/lib/roles";
import { LAYOUT_STATUS_FOR, layoutSchema, saveLayout } from "@/lib/scheduler/schedule";

const idSchema = z.string().uuid();

export const PUT = audited(async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireCaller(req, canManageTrainingSettings);
  if (error) return error;

  const id = idSchema.safeParse((await params).id);
  if (!id.success) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const parsed = layoutSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const result = await saveLayout(id.data, parsed.data);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: LAYOUT_STATUS_FOR[result.error] });
  return NextResponse.json({ ok: true });
});
