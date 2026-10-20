/** An Assessments Administrator's correction to one assessment of someone: its scores, comments and feedback. */

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCaller } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { SUBMISSION_EDIT_STATUS_FOR, editSubmission, submissionEditSchema } from "@/lib/reporting/bootcamp";
import { canManageBootcampRecords } from "@/lib/roles";

const idSchema = z.string().uuid();

export const PATCH = audited(async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireCaller(req, canManageBootcampRecords);
  if (error) return error;

  const id = idSchema.safeParse((await params).id);
  if (!id.success) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const parsed = submissionEditSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const result = await editSubmission(id.data, parsed.data);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: SUBMISSION_EDIT_STATUS_FOR[result.error] });
  }
  const { submission } = result;
  noteAudit({
    target: submission.id,
    targetLabel: `${submission.assessmentName}: ${submission.attendeeEmail}`,
    detail: { averageScore: submission.averageScore },
  });
  return NextResponse.json({ ok: true, submission });
});
