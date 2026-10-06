/** One subject's Iris questions with their keys, reviews and live statistics. Iris administrators only. */

import { notFound, redirect } from "next/navigation";
import { auth, signInPath } from "@/auth";
import { IRIS_REVIEW_STATUSES, type IrisReviewStatus } from "@/db/schema";
import type { Level } from "@/lib/iris/engine";
import { listQuestions, reviewCounts } from "@/lib/iris/questions";
import { SUBJECT_KEYS, isSubjectKey } from "@/lib/iris/subjects";
import { canManageIris } from "@/lib/roles";
import { QuestionsView } from "./questions-view";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function IrisQuestionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user) redirect(await signInPath());
  if (!canManageIris(session.user.access)) notFound();

  const params = await searchParams;
  const askedSubject = one(params.subject);
  const subject = isSubjectKey(askedSubject) ? askedSubject : SUBJECT_KEYS[0];
  const askedLevel = Number(one(params.level));
  const level = [1, 2, 3].includes(askedLevel) ? (askedLevel as Level) : undefined;
  const askedStatus = one(params.status);
  const status = IRIS_REVIEW_STATUSES.includes(askedStatus as IrisReviewStatus)
    ? (askedStatus as IrisReviewStatus)
    : undefined;

  const [questions, counts] = await Promise.all([
    listQuestions(subject, "A", { level, status }),
    reviewCounts(subject, "A"),
  ]);
  return (
    <QuestionsView
      subject={subject}
      level={level ?? null}
      status={status ?? null}
      counts={counts}
      questions={questions.map((q) => ({
        ...q,
        review: { ...q.review, updatedAt: q.review.updatedAt?.toISOString() ?? null },
      }))}
    />
  );
}
