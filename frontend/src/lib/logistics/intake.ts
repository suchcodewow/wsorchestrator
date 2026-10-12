/**
 * The logistics intake forms, one per stage, as Logistics settings saves
 * them, and the answers each person in the current cohort saves to theirs.
 */

import "server-only";

import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { intakeForms, intakeResponses, type IntakeFormId } from "@/db/schema";
import { nameOnRecord, setChosenName } from "@/lib/evals/chosen-names";
import { testGroupStageOf } from "@/lib/cohorts/test-group";
import { cohortStageOf } from "@/lib/evals/current-cohort";
import {
  DEFAULT_INTAKE_FORMS,
  INTAKE_FORM_HEADINGS,
  carriedAnswers,
  checkAnswers,
  isNameQuestion,
  lockNameQuestion,
  type AnswerProblem,
  type IntakeAnswers,
  type IntakeForm,
} from "@/lib/logistics/intake-values";

export type IntakeFormView = IntakeForm & { updatedAt: string | null };

/** A form's questions as they are asked: Pre-Bootcamp's with its name question locked in first. */
const asAsked = (id: IntakeFormId, questions: IntakeForm["questions"]) =>
  id === "bootcamp" ? lockNameQuestion(questions) : questions;

/**
 * The saved form, or its default with a null `updatedAt` if it has never been
 * saved. Pre-Bootcamp's name question is locked in as it is read, so one
 * saved before it was locked reads the same as one saved since.
 */
export async function getIntakeForm(id: IntakeFormId): Promise<IntakeFormView> {
  const [row] = await db.select().from(intakeForms).where(eq(intakeForms.id, id));
  if (!row) {
    const { introduction, questions } = DEFAULT_INTAKE_FORMS[id];
    return { introduction, questions: asAsked(id, questions), updatedAt: null };
  }
  return { introduction: row.introduction, questions: asAsked(id, row.questions), updatedAt: row.updatedAt.toISOString() };
}

/**
 * Replaces the whole form. Answers already saved keep the question ids they
 * were given under. On Pre-Bootcamp the name question is locked in whatever
 * was sent: first, and changed only in its title (`lockNameQuestion`).
 */
export async function saveIntakeForm(actorId: string, id: IntakeFormId, form: IntakeForm): Promise<IntakeFormView> {
  const values = {
    introduction: form.introduction,
    questions: asAsked(id, form.questions),
    updatedBy: actorId,
    updatedAt: new Date(),
  };
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
  /** Shown above the first question; empty for none. */
  introduction: string;
  questions: IntakeForm["questions"];
  answers: IntakeAnswers;
  savedAt: string | null;
  /**
   * When `answers` start from what they told an earlier form rather than their
   * own, which form and when: Pre-Intermediate, for someone with no answers to
   * it yet, starts from their Pre-Bootcamp dietary needs. Unset otherwise.
   */
  carriedFrom?: { form: IntakeFormId; savedAt: string };
  /**
   * The name the app has for them now — the one their email gives, until they
   * choose another — which the name question starts from until they answer it.
   */
  name: string | null;
  /** For a test group member in both stages: both forms, to switch between; unset for everyone else. */
  testForms?: IntakeFormId[];
};

/**
 * The stage whose form `email` fills in: their stage in the current cohort, or
 * while the test group is on, the one they were given there. `want` picks
 * between the two for someone in both. `test` marks the second kind, whose
 * answers are deleted when the group is turned off.
 */
async function intakeStageFor(
  email: string,
  want: IntakeFormId | null,
): Promise<{ stage: IntakeFormId; test: boolean; both: boolean } | null> {
  const real = await cohortStageOf(email);
  if (real) return { stage: real, test: false, both: false };
  const given = await testGroupStageOf(email);
  if (!given) return null;
  return { stage: given === "both" ? (want ?? "bootcamp") : given, test: true, both: given === "both" };
}

/**
 * The form for the stage `email` is in — Pre-Bootcamp for a bootcamp
 * candidate, Pre-Intermediate for an intermediate one — with their last
 * answers to it, or null for someone not in the current cohort.
 */
export async function getMyIntake(email: string, want: IntakeFormId | null = null): Promise<MyIntake | null> {
  const found = await intakeStageFor(email, want);
  if (!found) return null;
  const { stage } = found;
  const [{ introduction, questions }, name, latest] = await Promise.all([
    getIntakeForm(stage),
    nameOnRecord(email),
    latestAnswers(stage, email),
  ]);

  // Someone at intermediate who answered Pre-Bootcamp in an earlier cohort starts from what lasts of that.
  let carriedFrom: MyIntake["carriedFrom"];
  let answers = latest?.answers ?? {};
  if (!latest && stage === "intermediate") {
    const earlier = await latestAnswers("bootcamp", email);
    const carried = earlier ? carriedAnswers({ introduction, questions }, earlier.answers) : {};
    if (earlier && Object.keys(carried).length > 0) {
      answers = carried;
      carriedFrom = { form: "bootcamp", savedAt: earlier.submittedAt.toISOString() };
    }
  }

  return {
    form: stage,
    heading: INTAKE_FORM_HEADINGS[stage],
    introduction,
    questions,
    answers,
    savedAt: latest?.submittedAt.toISOString() ?? null,
    ...(carriedFrom ? { carriedFrom } : {}),
    name,
    ...(found.both ? { testForms: ["bootcamp", "intermediate"] as IntakeFormId[] } : {}),
  };
}

/** The answers `email` last saved to `form`, and when; undefined if they never have. */
async function latestAnswers(form: IntakeFormId, email: string) {
  const [row] = await db
    .select({ answers: intakeResponses.answers, submittedAt: intakeResponses.submittedAt })
    .from(intakeResponses)
    .where(and(eq(intakeResponses.form, form), eq(intakeResponses.email, email.toLowerCase())))
    .orderBy(desc(intakeResponses.submittedAt))
    .limit(1);
  return row;
}

/**
 * `no_questions`: their form asks nothing yet. Saving would count them as
 * having answered it, and so never remind them once it does ask something.
 */
export type SaveIntakeError = AnswerProblem | { problem: "not_in_cohort" } | { problem: "no_questions" };

/**
 * Checks someone's answers against their form as it stands now and saves them
 * as their latest, under their own email; `form` says which form that was.
 * Their answer to the name question becomes their name across the app.
 */
export async function saveMyIntake(
  email: string,
  answers: IntakeAnswers,
  actorId: string | null,
  want: IntakeFormId | null = null,
): Promise<{ ok: true; form: IntakeFormId; savedAt: string } | { ok: false; error: SaveIntakeError }> {
  const found = await intakeStageFor(email, want);
  if (!found) return { ok: false, error: { problem: "not_in_cohort" } };
  const { stage, test } = found;

  const form = await getIntakeForm(stage);
  if (form.questions.length === 0) return { ok: false, error: { problem: "no_questions" } };
  const checked = checkAnswers(form, answers);
  if (!checked.ok) return checked;

  const [row] = await db
    .insert(intakeResponses)
    .values({ form: stage, email: email.toLowerCase(), answers: checked.answers, test })
    .returning({ submittedAt: intakeResponses.submittedAt });

  const nameQuestion = form.questions.find(isNameQuestion);
  const name = nameQuestion && checked.answers[nameQuestion.id];
  // A test answer never renames a real employee.
  if (typeof name === "string" && !test) await setChosenName(email, name, actorId);

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
