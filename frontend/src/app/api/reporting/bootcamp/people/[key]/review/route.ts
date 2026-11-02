/** An Assessments Administrator's overall view of someone in one class: the overall feedback and both exams. */

import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { CLASS_REVIEW_STATUS_FOR, classReviewSchema, saveClassReview } from "@/lib/reporting/bootcamp";
import { STAGE_CODES } from "@/lib/reporting/bootcamp-values";
import { canManageBootcampRecords } from "@/lib/roles";

export const PUT = audited(async function PUT(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const { error, user } = await requireCaller(req, canManageBootcampRecords);
  if (error) return error;

  const parsed = classReviewSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const result = await saveClassReview(user.id, (await params).key, parsed.data);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: CLASS_REVIEW_STATUS_FOR[result.error] });
  }
  const { review } = result;
  noteAudit({
    target: `${review.bootcampId}:${review.stage}:${review.email}`,
    targetLabel: `${STAGE_CODES[review.stage]} review: ${review.email}`,
    detail: {
      bootcampId: review.bootcampId,
      entranceExam: parsed.data.entranceExam,
      exitExam: parsed.data.exitExam,
      examAverage: review.examAverage,
    },
  });
  return NextResponse.json({ ok: true, review });
});
