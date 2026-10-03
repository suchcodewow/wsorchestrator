/** Changes or removes one bootcamp. */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCaller } from "@/lib/api-auth";
import { audited } from "@/lib/audit";
import { canManageTrainingSettings } from "@/lib/roles";
import { bootcampPatchSchema, deleteBootcamp, updateBootcamp } from "@/lib/scheduler/bootcamps";

const idSchema = z.string().uuid();

export const PATCH = audited(async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireCaller(req, canManageTrainingSettings);
  if (error) return error;

  const id = idSchema.safeParse((await params).id);
  if (!id.success) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const parsed = bootcampPatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const result = await updateBootcamp(id.data, parsed.data);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, active: result.active },
      { status: result.error === "not_found" ? 404 : 409 },
    );
  }
  return NextResponse.json({ ok: true });
});

export const DELETE = audited(async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireCaller(req, canManageTrainingSettings);
  if (error) return error;

  const id = idSchema.safeParse((await params).id);
  if (!id.success || !(await deleteBootcamp(id.data))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
});
