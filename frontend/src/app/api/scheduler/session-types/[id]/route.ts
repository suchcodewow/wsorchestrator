/** One session type: changing or removing it. Sessions started from it keep what they took. */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCaller } from "@/lib/api-auth";
import { audited } from "@/lib/audit";
import { canManageTrainingSettings } from "@/lib/roles";
import { SESSION_TYPE_STATUS_FOR, deleteSessionType, sessionTypePatchSchema, updateSessionType } from "@/lib/scheduler/session-types";

const idSchema = z.string().uuid();

type Params = { params: Promise<{ id: string }> };

export const PATCH = audited(async function PATCH(req: Request, { params }: Params) {
  const { error } = await requireCaller(req, canManageTrainingSettings);
  if (error) return error;

  const id = idSchema.safeParse((await params).id);
  if (!id.success) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const parsed = sessionTypePatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const result = await updateSessionType(id.data, parsed.data);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: SESSION_TYPE_STATUS_FOR[result.error] });
  return NextResponse.json(result.type);
});

export const DELETE = audited(async function DELETE(req: Request, { params }: Params) {
  const { error } = await requireCaller(req, canManageTrainingSettings);
  if (error) return error;

  const id = idSchema.safeParse((await params).id);
  if (!id.success) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const result = await deleteSessionType(id.data);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 404 });
  return NextResponse.json({ ok: true });
});
