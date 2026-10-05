/**
 * The assessments attendees are scored on, as eVals administrators define
 * them in eVals Settings → Assessments.
 *
 * An assessment may change after it has been scored, so long as what was
 * scored stays readable: renaming or reordering is free, because a submission
 * copies the names it was scored against; a criterion that has been scored is
 * retired rather than deleted; and the stage and audience are fixed once
 * there is a score, since changing either would orphan the people scored.
 */

import "server-only";

import { and, asc, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  EVALS_ASSESSMENT_AUDIENCES,
  EVALS_ASSESSMENT_LIMITS,
  EVALS_ASSESSMENT_STAGES,
  evalsAssessmentCriteria,
  evalsAssessments,
  evalsSubmissionScores,
  evalsSubmissions,
  evalsTranscripts,
  type EvalsAssessmentAudience,
  type EvalsAssessmentStage,
} from "@/db/schema";
import type { AssessmentSort } from "@/lib/list-specs";
import { pageWindow, toPage, type ListQuery, type Page } from "@/lib/paging";
import { orderFor, searchAny } from "@/lib/paging-sql";
import { isForeignKeyViolation } from "@/lib/scheduler/pg-errors";

export type AssessmentRow = {
  id: string;
  name: string;
  stage: EvalsAssessmentStage;
  audience: EvalsAssessmentAudience;
  active: boolean;
  updatedAt: Date;
  /** Criteria still asked. */
  criteria: number;
  /** Attendees scored on it, at any bootcamp. */
  submissions: number;
};

export type CriterionRow = {
  id: string;
  name: string;
  description: string;
  /** Some submission holds a score against it, so removing it retires it. */
  scored: boolean;
};

export type AssessmentDetail = Omit<AssessmentRow, "criteria"> & {
  createdAt: Date;
  criteria: CriterionRow[];
};

// Spelled out, because Drizzle leaves the table off a column in a one-table
// query, and an unqualified `id` here would mean the inner table's own.
const criteriaCount = sql<number>`(
  select count(*)::int from ${evalsAssessmentCriteria} c
  where c.assessment_id = ${evalsAssessments}.id and c.retired_at is null
)`;

const submissionCount = sql<number>`(
  select count(*)::int from ${evalsSubmissions} s where s.assessment_id = ${evalsAssessments}.id
)`;

const SORT_COLUMNS = {
  name: sql`lower(${evalsAssessments.name})`,
  stage: evalsAssessments.stage,
  audience: evalsAssessments.audience,
  active: evalsAssessments.active,
  updatedAt: evalsAssessments.updatedAt,
} as const;

/**
 * One page of assessments; the search matches the name. With `only`, just
 * the active ones for one stage, as the eVals page offers them.
 */
export async function listAssessments(
  query: ListQuery<AssessmentSort>,
  only?: { stage: EvalsAssessmentStage; active: true },
): Promise<Page<AssessmentRow>> {
  const { limit, offset } = pageWindow(query.page);
  const rows = await db
    .select({
      id: evalsAssessments.id,
      name: evalsAssessments.name,
      stage: evalsAssessments.stage,
      audience: evalsAssessments.audience,
      active: evalsAssessments.active,
      updatedAt: evalsAssessments.updatedAt,
      criteria: criteriaCount,
      submissions: submissionCount,
    })
    .from(evalsAssessments)
    .where(
      and(
        searchAny(query.q, [evalsAssessments.name]),
        only ? and(eq(evalsAssessments.stage, only.stage), eq(evalsAssessments.active, true)) : undefined,
      ),
    )
    .orderBy(...orderFor(SORT_COLUMNS[query.sort], query.dir, sql`lower(${evalsAssessments.name})`, evalsAssessments.id))
    .limit(limit)
    .offset(offset);
  return toPage(rows, query.page);
}

/** How many assessments there are in all. */
export async function assessmentCount(): Promise<number> {
  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(evalsAssessments);
  return row?.count ?? 0;
}

/** One assessment with the criteria it still asks, in order. */
export async function getAssessment(id: string): Promise<AssessmentDetail | null> {
  const [row] = await db
    .select({
      id: evalsAssessments.id,
      name: evalsAssessments.name,
      stage: evalsAssessments.stage,
      audience: evalsAssessments.audience,
      active: evalsAssessments.active,
      createdAt: evalsAssessments.createdAt,
      updatedAt: evalsAssessments.updatedAt,
      submissions: submissionCount,
    })
    .from(evalsAssessments)
    .where(eq(evalsAssessments.id, id));
  if (!row) return null;

  // At most EVALS_ASSESSMENT_LIMITS.criteria rows: the save refuses more.
  const criteria = await db
    .select({
      id: evalsAssessmentCriteria.id,
      name: evalsAssessmentCriteria.name,
      description: evalsAssessmentCriteria.description,
      scored: sql<boolean>`exists (
        select 1 from ${evalsSubmissionScores} sc where sc.criterion_id = ${evalsAssessmentCriteria}.id
      )`,
    })
    .from(evalsAssessmentCriteria)
    .where(and(eq(evalsAssessmentCriteria.assessmentId, id), isNull(evalsAssessmentCriteria.retiredAt)))
    .orderBy(asc(evalsAssessmentCriteria.position), asc(evalsAssessmentCriteria.createdAt))
    .limit(EVALS_ASSESSMENT_LIMITS.criteria);

  return { ...row, criteria };
}

const L = EVALS_ASSESSMENT_LIMITS;

export const assessmentSchema = z.object({
  name: z.string().trim().min(1).max(L.name),
  stage: z.enum(EVALS_ASSESSMENT_STAGES),
  audience: z.enum(EVALS_ASSESSMENT_AUDIENCES),
  active: z.boolean(),
  /** In the order the form asks them. An `id` keeps an existing criterion; without one it is new. */
  criteria: z
    .array(
      z.object({
        id: z.string().uuid().optional(),
        name: z.string().trim().min(1).max(L.criterionName),
        description: z.string().trim().max(L.description).default(""),
      }),
    )
    .min(1)
    .max(L.criteria),
});

export type AssessmentInput = z.infer<typeof assessmentSchema>;

export type AssessmentError = "invalid" | "not_found" | "locked" | "has_scores";

export const ASSESSMENT_STATUS_FOR: Record<AssessmentError, number> = {
  invalid: 400,
  not_found: 404,
  locked: 409,
  has_scores: 409,
};

type Saved = { ok: true; id: string; name: string } | { ok: false; error: AssessmentError };

export async function createAssessment(actorId: string, input: AssessmentInput): Promise<Saved> {
  if (input.criteria.some((c) => c.id)) return { ok: false, error: "invalid" };
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(evalsAssessments)
      .values({
        name: input.name,
        stage: input.stage,
        audience: input.audience,
        active: input.active,
        createdBy: actorId,
      })
      .returning({ id: evalsAssessments.id, name: evalsAssessments.name });
    await tx.insert(evalsAssessmentCriteria).values(
      input.criteria.map((c, position) => ({
        assessmentId: row!.id,
        position,
        name: c.name,
        description: c.description,
      })),
    );
    return { ok: true as const, id: row!.id, name: row!.name };
  });
}

/**
 * Replaces an assessment's fields and criteria with `input`. A criterion left
 * out is deleted if nobody has been scored on it, and retired if somebody has.
 */
export async function updateAssessment(id: string, input: AssessmentInput): Promise<Saved> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ stage: evalsAssessments.stage, audience: evalsAssessments.audience })
      .from(evalsAssessments)
      .where(eq(evalsAssessments.id, id))
      .for("update");
    if (!current) return { ok: false as const, error: "not_found" as const };

    if (current.stage !== input.stage || current.audience !== input.audience) {
      const [scored] = await tx
        .select({ id: evalsSubmissions.id })
        .from(evalsSubmissions)
        .where(eq(evalsSubmissions.assessmentId, id))
        .limit(1);
      if (scored) return { ok: false as const, error: "locked" as const };
    }

    const existing = await tx
      .select({ id: evalsAssessmentCriteria.id })
      .from(evalsAssessmentCriteria)
      .where(and(eq(evalsAssessmentCriteria.assessmentId, id), isNull(evalsAssessmentCriteria.retiredAt)));
    const existingIds = new Set(existing.map((c) => c.id));
    const keptIds = input.criteria.flatMap((c) => (c.id ? [c.id] : []));
    if (new Set(keptIds).size !== keptIds.length || keptIds.some((k) => !existingIds.has(k))) {
      return { ok: false as const, error: "invalid" as const };
    }

    const dropped = [...existingIds].filter((k) => !keptIds.includes(k));
    if (dropped.length > 0) {
      const scored = await tx
        .selectDistinct({ id: evalsSubmissionScores.criterionId })
        .from(evalsSubmissionScores)
        .where(inArray(evalsSubmissionScores.criterionId, dropped));
      const retire = scored.map((s) => s.id);
      if (retire.length > 0) {
        await tx
          .update(evalsAssessmentCriteria)
          .set({ retiredAt: new Date() })
          .where(inArray(evalsAssessmentCriteria.id, retire));
      }
      await tx
        .delete(evalsAssessmentCriteria)
        .where(
          and(
            inArray(evalsAssessmentCriteria.id, dropped),
            retire.length > 0 ? notInArray(evalsAssessmentCriteria.id, retire) : undefined,
          ),
        );
    }

    for (const [position, c] of input.criteria.entries()) {
      if (c.id) {
        await tx
          .update(evalsAssessmentCriteria)
          .set({ position, name: c.name, description: c.description })
          .where(eq(evalsAssessmentCriteria.id, c.id));
      } else {
        await tx
          .insert(evalsAssessmentCriteria)
          .values({ assessmentId: id, position, name: c.name, description: c.description });
      }
    }

    const [row] = await tx
      .update(evalsAssessments)
      .set({
        name: input.name,
        stage: input.stage,
        audience: input.audience,
        active: input.active,
        updatedAt: new Date(),
      })
      .where(eq(evalsAssessments.id, id))
      .returning({ id: evalsAssessments.id, name: evalsAssessments.name });
    return { ok: true as const, id: row!.id, name: row!.name };
  });
}

/**
 * Removes an assessment nobody has been scored or recorded on; one with
 * either is made inactive instead.
 */
export async function deleteAssessment(id: string): Promise<{ ok: true; name: string } | { ok: false; error: AssessmentError }> {
  const [[scored], [recorded]] = await Promise.all([
    db.select({ id: evalsSubmissions.id }).from(evalsSubmissions).where(eq(evalsSubmissions.assessmentId, id)).limit(1),
    db.select({ id: evalsTranscripts.id }).from(evalsTranscripts).where(eq(evalsTranscripts.assessmentId, id)).limit(1),
  ]);
  const hasScores = async () => {
    const [exists] = await db.select({ id: evalsAssessments.id }).from(evalsAssessments).where(eq(evalsAssessments.id, id));
    return { ok: false as const, error: exists ? ("has_scores" as const) : ("not_found" as const) };
  };
  if (scored || recorded) return hasScores();
  let deleted: { name: string } | undefined;
  try {
    [deleted] = await db
      .delete(evalsAssessments)
      .where(eq(evalsAssessments.id, id))
      .returning({ name: evalsAssessments.name });
  } catch (err) {
    // Scored or recorded in between: the foreign key refuses it.
    if (isForeignKeyViolation(err)) return hasScores();
    throw err;
  }
  return deleted ? { ok: true, name: deleted.name } : { ok: false, error: "not_found" };
}
