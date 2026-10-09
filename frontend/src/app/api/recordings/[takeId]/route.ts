/** One recorded take with each of its streams, and removing it. */

import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { deleteTake, getTake } from "@/lib/recording/recordings";
import { canManageTrainingSettings, canUseTraining } from "@/lib/roles";

type Params = { params: Promise<{ takeId: string }> };

export async function GET(req: Request, { params }: Params) {
  const { error } = await requireCaller(req, canUseTraining);
  if (error) return error;

  const take = await getTake((await params).takeId);
  if (!take) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(take);
}

export const DELETE = audited(async function DELETE(req: Request, { params }: Params) {
  const { error } = await requireCaller(req, canManageTrainingSettings);
  if (error) return error;

  const { takeId } = await params;
  const contributor = await deleteTake(takeId);
  if (contributor === null) return NextResponse.json({ error: "not_found" }, { status: 404 });
  noteAudit({ target: takeId, targetLabel: contributor ? `recording by ${contributor}` : "recording" });
  return NextResponse.json({ ok: true });
});
