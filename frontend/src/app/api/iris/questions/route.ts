/** One subject's Iris questions on one form, with their keys, reviews and live statistics. */

import { NextResponse } from "next/server";
import { IRIS_REVIEW_STATUSES, type IrisReviewStatus } from "@/db/schema";
import { requireCaller } from "@/lib/api-auth";
import { isForm, type Level } from "@/lib/iris/engine";
import { listQuestions, reviewCounts } from "@/lib/iris/questions";
import { isSubjectKey } from "@/lib/iris/subjects";
import { canManageIris } from "@/lib/roles";

export async function GET(req: Request) {
  const { error } = await requireCaller(req, canManageIris);
  if (error) return error;
  const params = new URL(req.url).searchParams;
  const subject = params.get("subject");
  if (!isSubjectKey(subject)) return NextResponse.json({ error: "invalid_subject" }, { status: 400 });
  const form = params.get("form") ?? "A";
  if (!isForm(form)) return NextResponse.json({ error: "invalid_form" }, { status: 400 });
  const levelParam = params.get("level");
  const level = levelParam === null ? undefined : Number(levelParam);
  if (level !== undefined && ![1, 2, 3].includes(level)) {
    return NextResponse.json({ error: "invalid_level" }, { status: 400 });
  }
  const status = params.get("status") ?? undefined;
  if (status !== undefined && !IRIS_REVIEW_STATUSES.includes(status as IrisReviewStatus)) {
    return NextResponse.json({ error: "invalid_status" }, { status: 400 });
  }

  const questions = await listQuestions(subject, form, {
    level: level as Level | undefined,
    status: status as IrisReviewStatus | undefined,
  });
  return NextResponse.json({ questions, counts: await reviewCounts(subject, form) });
}
