/**
 * The logistics intake forms, one per stage, as Logistics settings saves
 * them, and the answers each person in the current cohort saves to theirs.
 */

import "server-only";

import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { intakeForms, intakeResponses, type IntakeFormId } from "@/db/schema";
import { cohortStageOf } from "@/lib/evals/current-cohort";
import {
  DEFAULT_INTAKE_FORMS,
  INTAKE_FORM_HEADINGS,
  checkAnswers,
  type AnswerProblem,
  type IntakeAnswers,
  type IntakeForm,
} from "@/lib/logistics/intake-values";

export type IntakeFormView = IntakeForm & { updatedAt: string | null };

/** The saved form, or its default with a null `updatedAt` if it has never been saved. */
export async function getIntakeForm(id: IntakeFormId): Promise<IntakeFormView> {
  const [row] = await db.select().from(intakeForms).where(eq(intakeForms.id, id));
  if (!row) return { ...DEFAULT_INTAKE_FORMS[id], updatedAt: null };
  return { questions: row.questions, updatedAt: row.updatedAt.toISOString() };
}

/** Replaces the whole form. Answers already saved keep the question ids they were given under. */
export async function saveIntakeForm(actorId: string, id: IntakeFormId, form: IntakeForm): Promise<IntakeFormView> {
  const values = { ...form, updatedBy: actorId, updatedAt: new Date() };
  await db
    .insert(intakeForms)
    .values({ id, ...values })
    .onConflictDoUpdate({ target: intakeForms.id, set: values });
  return getIntakeForm(id);
}

/** Someone's form, with the answers they last saved to it; `answers` is empty and `savedAt` null until they have. */
export type MyIntake = {
  form: IntakeFormId;
  /** "Bootcamp Registration" or "Intermediate Registration". */
  heading: string;
  questions: IntakeForm["questions"];
  answers: IntakeAnswers;
  savedAt: string | null;
};

/**
 * The form for the stage `email` is in — Pre-Bootcamp for a bootcamp
 * candidate, Pre-Intermediate for an intermediate one — with their last
 * answers to it, or null for someone not in the current cohort.
 */
export async function getMyIntake(email: string): Promise<MyIntake | null> {
  const stage = await cohortStageOf(email);
  if (!stage) return null;
  const [{ questions }, [latest]] = await Promise.all([
    getIntakeForm(stage),
    db
      .select({ answers: intakeResponses.answers, submittedAt: intakeResponses.submittedAt })
      .from(intakeResponses)
      .where(and(eq(intakeResponses.form, stage), eq(intakeResponses.email, email.toLowerCase())))
      .orderBy(desc(intakeResponses.submittedAt))
      .limit(1),
  ]);
  return {
    form: stage,
    heading: INTAKE_FORM_HEADINGS[stage],
    questions,
    answers: latest?.answers ?? {},
    savedAt: latest?.submittedAt.toISOString() ?? null,
  };
}

/**
 * `no_questions`: their form asks nothing yet. Saving would count them as
 * having answered it, and so never remind them once it does ask something.
 */
export type SaveIntakeError = AnswerProblem | { problem: "not_in_cohort" } | { problem: "no_questions" };

/**
 * Checks someone's answers against their form as it stands now and saves them
 * as their latest, under their own email; `form` says which form that was.
 */
export async function saveMyIntake(
  email: string,
  answers: IntakeAnswers,
): Promise<{ ok: true; form: IntakeFormId; savedAt: string } | { ok: false; error: SaveIntakeError }> {
  const stage = await cohortStageOf(email);
  if (!stage) return { ok: false, error: { problem: "not_in_cohort" } };

  const form = await getIntakeForm(stage);
  if (form.questions.length === 0) return { ok: false, error: { problem: "no_questions" } };
  const checked = checkAnswers(form, answers);
  if (!checked.ok) return checked;

  const [row] = await db
    .insert(intakeResponses)
    .values({ form: stage, email: email.toLowerCase(), answers: checked.answers })
    .returning({ submittedAt: intakeResponses.submittedAt });
  return { ok: true, form: stage, savedAt: row!.submittedAt.toISOString() };
}

/** Which of `emails`, lowercased, have saved answers to `form`. */
export async function answeredIntake(form: IntakeFormId, emails: string[]): Promise<Set<string>> {
  if (emails.length === 0) return new Set();
  const rows = await db
    .selectDistinct({ email: intakeResponses.email })
    .from(intakeResponses)
    .where(and(eq(intakeResponses.form, form), inArray(intakeResponses.email, emails)));
  return new Set(rows.map((r) => r.email));
}
