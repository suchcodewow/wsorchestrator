/**
 * Decides one queued grade of a typed Diagnostic answer: `correct` is the
 * grade it deserves, which upholds Claude's or overturns it. A finished
 * sitting is placed again on its answers. Assessments Administrators only.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCaller } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { decideGrade } from "@/lib/iris/grades";
import { canManageIris } from "@/lib/roles";

const paramsSchema = z.object({ attemptId: z.string().uuid(), seq: z.coerce.number().int().min(1).max(100) });
const bodySchema = z.object({ correct: z.boolean() });

export const PATCH = audited(async function PATCH(req: Request, { params }: { params: Promise<{ attemptId: string; seq: string }> }) {
  const { error, user } = await requireCaller(req, canManageIris);
  if (error) return error;
  const target = paramsSchema.safeParse(await params);
  if (!target.success) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const result = await decideGrade(target.data.attemptId, target.data.seq, user.id, parsed.data.correct);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 404 });
  noteAudit({
    target: target.data.attemptId,
    targetLabel: `Diagnostic grade, question ${target.data.seq}`,
    detail: { seq: target.data.seq, correct: parsed.data.correct, reviewStatus: result.reviewStatus, placement: result.placement },
  });
  return NextResponse.json(result);
});
