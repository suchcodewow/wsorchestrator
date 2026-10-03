/** Removes one guest judge from a bootcamp. */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCaller } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { canManageTrainingSettings } from "@/lib/roles";
import { removeJudge } from "@/lib/scheduler/judges";

const idSchema = z.string().uuid();

export const DELETE = audited(async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; judgeId: string }> },
) {
  const { error } = await requireCaller(req, canManageTrainingSettings);
  if (error) return error;

  const { id, judgeId } = await params;
  const bootcamp = idSchema.safeParse(id);
  const judge = idSchema.safeParse(judgeId);
  if (!bootcamp.success || !judge.success) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const result = await removeJudge(bootcamp.data, judge.data);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 404 });
  noteAudit({ target: judge.data, targetLabel: `${result.email}, judging bootcamp ${bootcamp.data}` });
  return NextResponse.json({ ok: true });
});
