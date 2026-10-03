/** One bootcamp and its judges: reading, changing or removing it. */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCaller } from "@/lib/api-auth";
import { audited } from "@/lib/audit";
import { canManageTrainingSettings, canUseTraining } from "@/lib/roles";
import { BOOTCAMP_STATUS_FOR, bootcampPatchSchema, deleteBootcamp, getBootcamp, updateBootcamp } from "@/lib/scheduler/bootcamps";

const idSchema = z.string().uuid();

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireCaller(req, canUseTraining);
  if (error) return error;

  const id = idSchema.safeParse((await params).id);
  const bootcamp = id.success ? await getBootcamp(id.data) : null;
  if (!bootcamp) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(bootcamp);
}

export const PATCH = audited(async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error, user } = await requireCaller(req, canManageTrainingSettings);
  if (error) return error;

  const id = idSchema.safeParse((await params).id);
  if (!id.success) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const parsed = bootcampPatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const result = await updateBootcamp(user.id, id.data, parsed.data);
  if (!result.ok) {
    const { error, active, email } = result;
    return NextResponse.json({ error, active, email }, { status: BOOTCAMP_STATUS_FOR[error] });
  }
  return NextResponse.json({ ok: true });
});

export const DELETE = audited(async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireCaller(req, canManageTrainingSettings);
  if (error) return error;

  const id = idSchema.safeParse((await params).id);
  if (!id.success) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const result = await deleteBootcamp(id.data);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.error === "not_found" ? 404 : 409 });
  }
  return NextResponse.json({ ok: true });
});
