/** One attendee's submission for one assessment at the active bootcamp: reading it, and saving it. */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCaller } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import {
  getScoringForm,
  saveSubmission,
  scoringAssessment,
  scoringBootcamp,
  submissionSchema,
  SUBMISSION_STATUS_FOR,
} from "@/lib/evals/scoring";
import { canScoreAssessments } from "@/lib/roles";

type Params = { params: Promise<{ assessmentId: string; employeeId: string }> };

const assessmentIdSchema = z.string().uuid();
const employeeIdSchema = z.string().min(1).max(200);

export async function GET(req: Request, { params }: Params) {
  const { error } = await requireCaller(req, canScoreAssessments);
  if (error) return error;

  const { assessmentId, employeeId } = await params;
  const id = assessmentIdSchema.safeParse(assessmentId);
  const employee = employeeIdSchema.safeParse(employeeId);
  const assessment = id.success && employee.success ? await scoringAssessment(id.data) : null;
  if (!assessment) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const bootcamp = await scoringBootcamp(assessment.stage);
  const form = await getScoringForm(assessment.id, employee.data!, bootcamp?.id ?? null);
  if (!form) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ...form, bootcamp });
}

export const PUT = audited(async function PUT(req: Request, { params }: Params) {
  const { error, user } = await requireCaller(req, canScoreAssessments);
  if (error) return error;

  const { assessmentId, employeeId } = await params;
  const id = assessmentIdSchema.safeParse(assessmentId);
  const employee = employeeIdSchema.safeParse(employeeId);
  if (!id.success || !employee.success) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const parsed = submissionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const result = await saveSubmission(user.id, id.data, employee.data, parsed.data);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: SUBMISSION_STATUS_FOR[result.error] });
  }
  const { submission } = result;
  noteAudit({
    target: submission.id,
    targetLabel: `${submission.attendeeEmail}, ${submission.assessmentName}: ${submission.averageScore}`,
  });
  return NextResponse.json(submission);
});
