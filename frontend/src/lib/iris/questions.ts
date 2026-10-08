/**
 * The question bank as Assessments Administrators review it: one subject and form at
 * a time, each question with its key, its review, and how it has performed in
 * live sittings of its current version.
 */

import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { irisAttempts, irisResponses, type IrisReviewStatus } from "@/db/schema";
import { IDK, type Form, type Level } from "@/lib/iris/engine";
import { itemsOf, reviewsOf, type Review } from "@/lib/iris/reviews";
import type { SubjectKey } from "@/lib/iris/subjects";

export type ItemStats = {
  responses: number;
  correct: number;
  dontKnow: number;
  /** How many chose each option, A to D. */
  picks: [number, number, number, number];
  medianMs: number | null;
};

/** Iris's reading of an item's numbers; only meaningful once enough people have answered it. */
export type Calibration =
  | { kind: "needs_responses"; more: number }
  | { kind: "too_easy" | "too_hard" | "healthy" }
  | { kind: "dead_distractors"; options: number[]; also: "too_easy" | "too_hard" | "needs_responses" | null };

export type QuestionRow = {
  id: string;
  version: string;
  level: Level;
  subtopic: string;
  stem: string;
  options: readonly string[];
  answer: number;
  rationale: string;
  review: Review;
  stats: ItemStats;
  calibration: Calibration;
};

const EMPTY: ItemStats = { responses: 0, correct: 0, dontKnow: 0, picks: [0, 0, 0, 0], medianMs: null };

/** Responses before a correct rate is read as too easy or too hard. */
export const CALIBRATION_MIN = 20;
/** Responses before an option nobody chose counts as a dead distractor. */
export const DISTRACTOR_MIN = 10;

export function calibrationOf(stats: ItemStats, answer: number): Calibration {
  const rate = stats.responses ? stats.correct / stats.responses : 0;
  const base =
    stats.responses < CALIBRATION_MIN
      ? ({ kind: "needs_responses", more: CALIBRATION_MIN - stats.responses } as const)
      : rate > 0.85
        ? ({ kind: "too_easy" } as const)
        : rate < 0.45
          ? ({ kind: "too_hard" } as const)
          : ({ kind: "healthy" } as const);
  // A wrong option nobody picks is a hint, not a distractor: the question can
  // be answered by elimination.
  const dead =
    stats.responses >= DISTRACTOR_MIN ? [0, 1, 2, 3].filter((i) => i !== answer && stats.picks[i] === 0) : [];
  if (dead.length) return { kind: "dead_distractors", options: dead, also: base.kind === "healthy" ? null : base.kind };
  return base;
}

/** Every question on one subject and form, in bank order, with its review and live statistics. */
export async function listQuestions(
  subject: SubjectKey,
  form: Form,
  filter: { level?: Level; status?: IrisReviewStatus } = {},
): Promise<QuestionRow[]> {
  const items = itemsOf(subject, form);
  const reviews = await reviewsOf(items);
  const stats = await statsOf(items.map((i) => ({ id: i.id, version: i.version })));
  return items
    .filter((i) => (filter.level ? i.level === filter.level : true))
    .filter((i) => (filter.status ? reviews.get(i.id)!.status === filter.status : true))
    .map((i) => {
      const s = stats.get(i.id) ?? EMPTY;
      return {
        id: i.id,
        version: i.version,
        level: i.level,
        subtopic: i.subtopic,
        stem: i.stem,
        options: i.options,
        answer: i.answer,
        rationale: i.rationale,
        review: reviews.get(i.id)!,
        stats: s,
        calibration: calibrationOf(s, i.answer),
      };
    });
}

/** Live-sitting statistics for each item's current version: one row per item, at most 38. */
async function statsOf(items: { id: string; version: string }[]): Promise<Map<string, ItemStats>> {
  const out = new Map<string, ItemStats>();
  if (items.length === 0) return out;
  const rows = await db
    .select({
      itemId: irisResponses.itemId,
      itemVersion: irisResponses.itemVersion,
      responses: sql<number>`count(*)::int`,
      correct: sql<number>`count(*) filter (where ${irisResponses.correct})::int`,
      dontKnow: sql<number>`count(*) filter (where ${irisResponses.choice} = ${IDK})::int`,
      a: sql<number>`count(*) filter (where ${irisResponses.choice} = 0)::int`,
      b: sql<number>`count(*) filter (where ${irisResponses.choice} = 1)::int`,
      c: sql<number>`count(*) filter (where ${irisResponses.choice} = 2)::int`,
      d: sql<number>`count(*) filter (where ${irisResponses.choice} = 3)::int`,
      medianMs: sql<number | null>`percentile_disc(0.5) within group (order by ${irisResponses.ms})`,
    })
    .from(irisResponses)
    .innerJoin(irisAttempts, eq(irisAttempts.id, irisResponses.attemptId))
    .where(and(eq(irisAttempts.mode, "live"), inArray(irisResponses.itemId, items.map((i) => i.id))))
    .groupBy(irisResponses.itemId, irisResponses.itemVersion);

  const versions = new Map(items.map((i) => [i.id, i.version]));
  for (const r of rows) {
    if (versions.get(r.itemId) !== r.itemVersion) continue;
    out.set(r.itemId, {
      responses: r.responses,
      correct: r.correct,
      dontKnow: r.dontKnow,
      picks: [r.a, r.b, r.c, r.d],
      medianMs: r.medianMs === null ? null : Number(r.medianMs),
    });
  }
  return out;
}

/** How many questions on one subject and form are in each review state. */
export async function reviewCounts(subject: SubjectKey, form: Form): Promise<Record<IrisReviewStatus, number>> {
  const reviews = await reviewsOf(itemsOf(subject, form));
  const counts: Record<IrisReviewStatus, number> = { approved: 0, rejected: 0, draft: 0 };
  for (const r of reviews.values()) counts[r.status]++;
  return counts;
}
