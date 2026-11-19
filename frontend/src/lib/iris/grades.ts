/**
 * Diagnostic Settings → Grades: typed answers whose grade Claude was unsure
 * of, for an Assessments Administrator to check. Such a grade counted as soon
 * as it was given, so the sitting went on; deciding it here upholds it, or
 * overturns it and puts the corrected grade on the record. A finished
 * sitting's placement and confidence are worked out again from its answers
 * with the corrected grade. The questions it was asked stay as they were.
 */

import "server-only";

import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { irisAttempts, irisResponses, irisTextAnswers, users, type IrisGradeConfidence, type IrisGradeReviewStatus } from "@/db/schema";
import { confidenceOf, isTextItem, placementOf, type Asked, type Confidence, type Level } from "@/lib/iris/engine";
import { ITEMS_BY_ID } from "@/lib/iris/reviews";
import type { SubjectKey } from "@/lib/iris/subjects";
import type { IrisGradeSort } from "@/lib/list-specs";
import { pageWindow, toPage, type ListQuery, type Page } from "@/lib/paging";
import { orderFor, searchAny } from "@/lib/paging-sql";

export type IrisGradeRow = {
  attemptId: string;
  seq: number;
  subject: SubjectKey;
  itemId: string;
  /** The question and what an expert would say; null once the question is no longer in the bank. */
  stem: string | null;
  expected: string | null;
  answer: string;
  /** Claude's grade, as given. */
  gradedCorrect: boolean;
  /** The grade that counts: Claude's, or the reviewer's once decided. */
  correct: boolean;
  confidence: IrisGradeConfidence;
  matched: string[];
  reason: string;
  reviewStatus: IrisGradeReviewStatus;
  gradedAt: string;
  user: { name: string | null; email: string | null } | null;
  reviewedAt: string | null;
  reviewedBy: { name: string | null; email: string | null } | null;
};

const SORT_COLUMNS: Record<IrisGradeSort, ReturnType<typeof sql>> = {
  gradedAt: sql`t.graded_at`,
  user: sql`lower(coalesce(nullif(u.name, ''), u.email))`,
  subject: sql`a.subject`,
};

/**
 * The grades waiting on review, oldest first, a page at a time, searched by
 * the answer, the question or who gave it; the decided ones too when `decided`.
 */
export async function listGrades(
  query: ListQuery<IrisGradeSort>,
  { decided = false }: { decided?: boolean } = {},
): Promise<Page<IrisGradeRow>> {
  const { limit, offset } = pageWindow(query.page);
  const search = searchAny(query.q, [sql`t.answer`, sql`r.item_id`, sql`u.name`, sql`u.email`]) ?? sql`true`;
  const where = decided ? sql`${search} and t.review_status is not null` : sql`${search} and t.review_status = 'pending'`;
  const order = orderFor(SORT_COLUMNS[query.sort], query.dir, sql`t.graded_at asc`, sql`t.attempt_id, t.seq`);
  const { rows } = await db.execute<{
    attemptId: string;
    seq: number;
    subject: string;
    itemId: string;
    answer: string;
    gradedCorrect: boolean;
    correct: boolean;
    confidence: IrisGradeConfidence;
    matched: string[];
    reason: string;
    reviewStatus: IrisGradeReviewStatus;
    gradedAt: string;
    reviewedAt: string | null;
    userId: string | null;
    userName: string | null;
    userEmail: string | null;
    reviewerId: string | null;
    reviewerName: string | null;
    reviewerEmail: string | null;
  }>(sql`
    select t.attempt_id as "attemptId", t.seq, a.subject, r.item_id as "itemId", t.answer,
           t.graded_correct as "gradedCorrect", r.correct, t.confidence, t.matched, t.reason,
           t.review_status as "reviewStatus", t.graded_at as "gradedAt", t.reviewed_at as "reviewedAt",
           a.user_id as "userId", u.name as "userName", u.email as "userEmail",
           t.reviewed_by as "reviewerId", v.name as "reviewerName", v.email as "reviewerEmail"
      from ${irisTextAnswers} t
      join ${irisResponses} r on r.attempt_id = t.attempt_id and r.seq = t.seq
      join ${irisAttempts} a on a.id = t.attempt_id
      left join ${users} u on u.id = a.user_id
      left join ${users} v on v.id = t.reviewed_by
     where ${where}
     order by ${sql.join(order, sql`, `)}
     limit ${limit} offset ${offset}`);
  return toPage(
    rows.map(({ userId, userName, userEmail, reviewerId, reviewerName, reviewerEmail, ...r }) => {
      const item = ITEMS_BY_ID.get(r.itemId);
      return {
        ...r,
        subject: r.subject as SubjectKey,
        stem: item?.stem ?? null,
        expected: item && isTextItem(item) ? item.key.expected : null,
        gradedAt: new Date(r.gradedAt).toISOString(),
        reviewedAt: r.reviewedAt ? new Date(r.reviewedAt).toISOString() : null,
        user: userId ? { name: userName, email: userEmail } : null,
        reviewedBy: reviewerId ? { name: reviewerName, email: reviewerEmail } : null,
      };
    }),
    query.page,
  );
}

export type DecideGradeResult =
  | {
      ok: true;
      reviewStatus: Exclude<IrisGradeReviewStatus, "pending">;
      /** The sitting's placement and confidence after the decision; null while it is still going. */
      placement: Level | null;
      confidence: Confidence | null;
    }
  | { ok: false; error: "not_found" };

/**
 * Decides one queued grade as `reviewerId`: `correct` is the grade the
 * answer deserves. The same as Claude's upholds it; the other overturns it. A
 * decision can be made again, and the latest stands.
 */
export async function decideGrade(attemptId: string, seq: number, reviewerId: string, correct: boolean): Promise<DecideGradeResult> {
  return db.transaction(async (tx) => {
    // The sitting first, as answering it does, so a decision and an answer to it wait on each other.
    const [attempt] = await tx.select().from(irisAttempts).where(eq(irisAttempts.id, attemptId)).for("update");
    if (!attempt) return { ok: false, error: "not_found" };
    const [graded] = await tx
      .select()
      .from(irisTextAnswers)
      .where(and(eq(irisTextAnswers.attemptId, attemptId), eq(irisTextAnswers.seq, seq)));
    if (!graded || graded.reviewStatus === null) return { ok: false, error: "not_found" };

    const reviewStatus = correct === graded.gradedCorrect ? "upheld" : "overturned";
    const now = new Date();
    await tx
      .update(irisTextAnswers)
      .set({ reviewStatus, reviewedBy: reviewerId, reviewedAt: now })
      .where(and(eq(irisTextAnswers.attemptId, attemptId), eq(irisTextAnswers.seq, seq)));
    await tx
      .update(irisResponses)
      .set({ correct })
      .where(and(eq(irisResponses.attemptId, attemptId), eq(irisResponses.seq, seq)));

    // A sitting still going reads its answers afresh on the next one, so only a finished one is placed again.
    if (!attempt.finishedAt) return { ok: true, reviewStatus, placement: null, confidence: null };
    const asked = (await tx
      .select({
        id: irisResponses.itemId,
        level: irisResponses.level,
        subtopic: irisResponses.subtopic,
        correct: irisResponses.correct,
        phase: irisResponses.phase,
      })
      .from(irisResponses)
      .where(eq(irisResponses.attemptId, attemptId))
      .orderBy(asc(irisResponses.seq))) as Asked[];
    const placement = placementOf(asked);
    const confidence = confidenceOf(asked);
    await tx.update(irisAttempts).set({ placement, confidence }).where(eq(irisAttempts.id, attemptId));
    return { ok: true, reviewStatus, placement, confidence };
  });
}
