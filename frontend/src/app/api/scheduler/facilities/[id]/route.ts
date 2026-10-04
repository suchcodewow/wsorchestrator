/** One facility and its rooms: reading, changing or removing it. */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCaller } from "@/lib/api-auth";
import { audited } from "@/lib/audit";
import { canManageTrainingSettings, canUseTraining } from "@/lib/roles";
import { FACILITY_STATUS_FOR, deleteFacility, facilityPatchSchema, getFacility, updateFacility } from "@/lib/scheduler/facilities";

const idSchema = z.string().uuid();

type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  const { error } = await requireCaller(req, canUseTraining);
  if (error) return error;

  const id = idSchema.safeParse((await params).id);
  const facility = id.success ? await getFacility(id.data) : null;
  if (!facility) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(facility);
}

export const PATCH = audited(async function PATCH(req: Request, { params }: Params) {
  const { error } = await requireCaller(req, canManageTrainingSettings);
  if (error) return error;

  const id = idSchema.safeParse((await params).id);
  if (!id.success) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const parsed = facilityPatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const result = await updateFacility(id.data, parsed.data);
  if (!result.ok) {
    return NextResponse.json({ error: result.error, room: result.room }, { status: FACILITY_STATUS_FOR[result.error] });
  }
  return NextResponse.json({ ok: true });
});

export const DELETE = audited(async function DELETE(req: Request, { params }: Params) {
  const { error } = await requireCaller(req, canManageTrainingSettings);
  if (error) return error;

  const id = idSchema.safeParse((await params).id);
  if (!id.success) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const result = await deleteFacility(id.data);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 404 });
  return NextResponse.json({ ok: true });
});
