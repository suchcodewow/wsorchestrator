/** The logistics intake form, as Logistics settings saves it, and the answers attendees send. */

import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { intakeForms, intakeResponses } from "@/db/schema";
import {
  DEFAULT_INTAKE_FORM,
  checkAnswers,
  type AnswerProblem,
  type IntakeAnswers,
  type IntakeForm,
} from "@/lib/logistics/intake-values";

const FORM_ID = "intake";

export type IntakeFormView = IntakeForm & { updatedAt: string | null };

/** The saved form, or the default with a null `updatedAt` if it has never been saved. */
export async function getIntakeForm(): Promise<IntakeFormView> {
  const [row] = await db.select().from(intakeForms).where(eq(intakeForms.id, FORM_ID));
  if (!row) return { ...DEFAULT_INTAKE_FORM, updatedAt: null };
  return {
    title: row.title,
    description: row.description,
    questions: row.questions,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Replaces the whole form. Answers already sent keep the question ids they were given under. */
export async function saveIntakeForm(actorId: string, form: IntakeForm): Promise<IntakeFormView> {
  const values = { ...form, updatedBy: actorId, updatedAt: new Date() };
  await db
    .insert(intakeForms)
    .values({ id: FORM_ID, ...values })
    .onConflictDoUpdate({ target: intakeForms.id, set: values });
  return getIntakeForm();
}

/** Checks an attendee's answers against the form as it stands now and stores them. */
export async function submitIntake(
  email: string,
  answers: IntakeAnswers,
): Promise<{ ok: true; id: string } | { ok: false; error: AnswerProblem }> {
  const checked = checkAnswers(await getIntakeForm(), answers);
  if (!checked.ok) return checked;

  const [row] = await db
    .insert(intakeResponses)
    .values({ email, answers: checked.answers })
    .returning({ id: intakeResponses.id });
  return { ok: true, id: row!.id };
}
