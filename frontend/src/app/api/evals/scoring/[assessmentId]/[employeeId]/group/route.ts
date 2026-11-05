/** Everyone evaluated with this attendee, for the judge's participation popup. */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCaller } from "@/lib/api-auth";
import { evaluationGroup } from "@/lib/evals/participation";
import { scoringAssessment } from "@/lib/evals/scoring";
import { canSeeEvals } from "@/lib/roles";

type Params = { params: Promise<{ assessmentId: string; employeeId: string }> };

const assessmentIdSchema = z.string().uuid();
const employeeIdSchema = z.string().min(1).max(200);

export async function GET(req: Request, { params }: Params) {
  const { error, user } = await requireCaller(req, canSeeEvals);
  if (error) return error;

  const { assessmentId, employeeId } = await params;
  const id = assessmentIdSchema.safeParse(assessmentId);
  const employee = employeeIdSchema.safeParse(employeeId);
  const assessment = id.success && employee.success ? await scoringAssessment(id.data) : null;
  if (!assessment) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json({ people: await evaluationGroup(assessment.id, employee.data!, user.email) });
}
