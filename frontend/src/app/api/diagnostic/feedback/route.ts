/**
 * Ratings given while taking a Diagnostic test: a taker rates the question on
 * screen in their own sitting; Assessments Administrators read them back, a
 * page at a time, for Diagnostic Settings → Feedback, the closed ones only when asked.
 */

import { NextResponse } from "next/server";
import { requireCaller } from "@/lib/api-auth";
import { audited, noteAudit } from "@/lib/audit";
import { sittingModes } from "@/lib/iris/attempts";
import { irisFeedbackSchema, listIrisFeedback, recordIrisFeedback, type IrisFeedbackError } from "@/lib/iris/feedback";
import { IRIS_FEEDBACK_LIST } from "@/lib/list-specs";
import { parseListQuery } from "@/lib/paging";
import { canManageIris, canSitIris } from "@/lib/roles";

const STATUS: Record<IrisFeedbackError, number> = { not_found: 404, finished: 409, stale: 409 };

export async function GET(req: Request) {
  const { error } = await requireCaller(req, canManageIris);
  if (error) return error;

  const params = new URL(req.url).searchParams;
  const { rows, page, hasMore } = await listIrisFeedback(parseListQuery(params, IRIS_FEEDBACK_LIST), {
    closed: params.get("closed") === "1",
  });
  return NextResponse.json({ feedback: rows, page, hasMore });
}

export const POST = audited(async function POST(req: Request) {
  const { error, user } = await requireCaller(req, canSitIris);
  if (error) return error;

  const parsed = irisFeedbackSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });

  const result = await recordIrisFeedback(user.id, parsed.data, sittingModes(user.access));
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: STATUS[result.error] });
  const { feedback } = result;
  noteAudit({
    target: feedback.id,
    targetLabel: `${feedback.subject} question ${feedback.number}`,
    detail: { attemptId: parsed.data.attemptId, itemId: feedback.itemId, rating: feedback.rating },
  });
  return NextResponse.json({ feedback }, { status: 201 });
});
