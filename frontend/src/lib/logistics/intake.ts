/**
 * The logistics intake forms, one per stage, as Logistics settings saves
 * them, and the answers each person in the current cohort saves to theirs.
 */

import "server-only";

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  employees,
  intakeForms,
  intakeResponses,
  type IntakeFormId,
} from "@/db/schema";
import {
  chosenNameOnRecord,
  setChosenName,
} from "@/lib/evals/chosen-names";
import { setTimezone, timezoneOnRecord } from "@/lib/evals/timezones";
import { testGroupStageOf } from "@/lib/cohorts/test-group";
import { cohortStageOf } from "@/lib/evals/current-cohort";
import { nextBootcamp, nextIntermediate, setTrack } from "@/lib/evals/tracks";
import {
  DEFAULT_INTAKE_FORMS,
  INTAKE_FORM_HEADINGS,
  carriedAnswers,
  checkAnswers,
  firstNameOf,
  isNameQuestion,
  isTimezoneQuestion,
  withAutomaticQuestions,
  withBootcampDates,
  withIntermediateDates,
  withoutAutomaticQuestions,
  type AnswerProblem,
  type IntakeAnswers,
  type IntakeForm,
} from "@/lib/logistics/intake-values";

export type IntakeFormView = IntakeForm & { updatedAt: string | null };

/**
 * The form as the form builder keeps it, or its default with a null
 * `updatedAt` if it has never been saved. The automatic questions, the name
 * and the time zone, are never part of it, even in a form saved
 * while they were.
 */
export async function getEditableIntakeForm(
  id: IntakeFormId,
): Promise<IntakeFormView> {
  const [row] = await db
    .select()
    .from(intakeForms)
    .where(eq(intakeForms.id, id));
  if (!row) {
    const { introduction, questions } = DEFAULT_INTAKE_FORMS[id];
    return { introduction, questions, updatedAt: null };
  }
  return {
    introduction: row.introduction,
    questions: withoutAutomaticQuestions(id, row.questions),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * The form as it is asked: the saved one (`getEditableIntakeForm`), with
 * the automatic name and time zone questions in front of its own.
 */
export async function getIntakeForm(id: IntakeFormId): Promise<IntakeFormView> {
  const form = await getEditableIntakeForm(id);
  return { ...form, questions: withAutomaticQuestions(id, form.questions) };
}

/**
 * Replaces the whole form. Answers already saved keep the question ids they
 * were given under. The automatic questions are dropped
 * from whatever was sent: they are asked without being saved.
 */
export async function saveIntakeForm(
  actorId: string,
  id: IntakeFormId,
  form: IntakeForm,
): Promise<IntakeFormView> {
  const values = {
    introduction: form.introduction,
    questions: withoutAutomaticQuestions(id, form.questions),
    updatedBy: actorId,
    updatedAt: new Date(),
  };
  await db
    .insert(intakeForms)
    .values({ id, ...values })
    .onConflictDoUpdate({ target: intakeForms.id, set: values });
  return getEditableIntakeForm(id);
}

/** Someone's form, with the answers they last saved to it; `answers` is empty and `savedAt` null until they have. */
export type MyIntake = {
  form: IntakeFormId;
  /** "Bootcamp Registration" or "Intermediate Registration". */
  heading: string;
  /**
   * Shown above the first question; empty for none. It opens with the dates of
   * the next class, Bootcamp's or Intermediate's, then the introduction saved
   * in Logistics settings. The dates are in `**bold**`.
   */
  introduction: string;
  /** Whether they are asked to sign up for the next class of their stage or defer to the one after: both forms. */
  canDefer: boolean;
  questions: IntakeForm["questions"];
  answers: IntakeAnswers;
  savedAt: string | null;
  /**
   * When `answers` start from what they told an earlier form rather than their
   * own, which form and when: Pre-Intermediate, for someone with no answers to
   * it yet, starts from their Pre-Bootcamp dietary needs. Unset otherwise.
   */
  carriedFrom?: { form: IntakeFormId; savedAt: string };
  /** The preferred name they chose, which the name question starts from until they answer it; null if they have none. */
  name: string | null;
  /** The time zone the app has for them now, which the time zone question starts from until they answer it. */
  timezone: string | null;
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
  return {
    stage: given === "both" ? (want ?? "bootcamp") : given,
    test: true,
    both: given === "both",
  };
}

/**
 * The form for the stage `email` is in — Pre-Bootcamp for a bootcamp
 * candidate, Pre-Intermediate for an intermediate one — with their last
 * answers to it, or null for someone not in the current cohort.
 */
export async function getMyIntake(
  email: string,
  want: IntakeFormId | null = null,
): Promise<MyIntake | null> {
  const found = await intakeStageFor(email, want);
  if (!found) return null;
  const { stage } = found;
  const [{ introduction, questions }, name, timezone, latest] =
    await Promise.all([
      getIntakeForm(stage),
      chosenNameOnRecord(email),
      timezoneOnRecord(email),
      latestAnswers(stage, email),
    ]);

  // Someone at intermediate who answered Pre-Bootcamp in an earlier cohort starts from what lasts of that.
  let carriedFrom: MyIntake["carriedFrom"];
  let answers = latest?.answers ?? {};
  if (!latest && stage === "intermediate") {
    const earlier = await latestAnswers("bootcamp", email);
    const carried = earlier
      ? carriedAnswers({ introduction, questions }, earlier.answers)
      : {};
    if (earlier && Object.keys(carried).length > 0) {
      answers = carried;
      carriedFrom = {
        form: "bootcamp",
        savedAt: earlier.submittedAt.toISOString(),
      };
    }
  }

  // The name question holds a first name; an answer saved when it took a full name starts from its first.
  const nameQuestion = questions.find(isNameQuestion);
  const savedName = nameQuestion && answers[nameQuestion.id];
  if (nameQuestion && typeof savedName === "string")
    answers = { ...answers, [nameQuestion.id]: firstNameOf(savedName) };

  return {
    form: stage,
    heading: INTAKE_FORM_HEADINGS[stage],
    introduction: await previewIntroduction(stage, introduction),
    canDefer: true,
    questions,
    answers,
    savedAt: latest?.submittedAt.toISOString() ?? null,
    ...(carriedFrom ? { carriedFrom } : {}),
    name: name ? firstNameOf(name) : null,
    timezone,
    ...(found.both
      ? { testForms: ["bootcamp", "intermediate"] as IntakeFormId[] }
      : {}),
  };
}

/**
 * A form's introduction as the cohort sees it: led by the dates of the next
 * class of its stage, as `getMyIntake` has it. Also for a preview.
 */
export async function previewIntroduction(
  id: IntakeFormId,
  introduction: string,
): Promise<string> {
  return id === "bootcamp"
    ? withBootcampDates(introduction, await nextBootcamp())
    : withIntermediateDates(introduction, await nextIntermediate());
}

/**
 * Moves `email` from Pre-Bootcamp or Pre-Intermediate to the Deferred track,
 * to wait for the class after the next. They are then off the Current tab, so
 * no longer asked the form. A test group member's deferral is acknowledged, not made:
 * no real employee's track changes for a test.
 */
export async function deferMyIntake(
  actorId: string,
  email: string,
  want: IntakeFormId | null = null,
): Promise<
  | { ok: true; test: boolean }
  | { ok: false; error: "not_in_cohort" }
> {
  const found = await intakeStageFor(email, want);
  if (!found) return { ok: false, error: "not_in_cohort" };
  if (found.test) return { ok: true, test: true };
  const set = await setTrack(actorId, email.trim().toLowerCase(), "deferred");
  return set.ok
    ? { ok: true, test: false }
    : { ok: false, error: "not_in_cohort" };
}

/**
 * The stage `email` deferred from, if their track is Deferred, which is how
 * someone who deferred their registration reads afterwards: Bootcamp if they
 * have no Bootcamp date yet, else Intermediate (the stage rule of the Cohorts
 * page). Null for anyone not deferred.
 */
export async function deferredStageOf(
  email: string,
): Promise<IntakeFormId | null> {
  const [row] = await db
    .select({ track: employees.track, btcDate: employees.btcDate })
    .from(employees)
    .where(sql`lower(${employees.email}) = ${email.trim().toLowerCase()}`)
    .limit(1);
  if (row?.track !== "deferred") return null;
  return row.btcDate === null ? "bootcamp" : "intermediate";
}

/** The answers `email` last saved to `form`, and when; undefined if they never have. */
async function latestAnswers(form: IntakeFormId, email: string) {
  const [row] = await db
    .select({
      answers: intakeResponses.answers,
      submittedAt: intakeResponses.submittedAt,
    })
    .from(intakeResponses)
    .where(
      and(
        eq(intakeResponses.form, form),
        eq(intakeResponses.email, email.toLowerCase()),
      ),
    )
    .orderBy(desc(intakeResponses.submittedAt))
    .limit(1);
  return row;
}

/**
 * `no_questions`: their form asks nothing yet. Saving would count them as
 * having answered it, and so never remind them once it does ask something.
 */
export type SaveIntakeError =
  AnswerProblem | { problem: "not_in_cohort" } | { problem: "no_questions" };

/**
 * Checks someone's answers against their form as it stands now and saves them
 * as their latest, under their own email; `form` says which form that was.
 * Their answer to the name question becomes their name across the app, and
 * their answer to the time zone question their time zone.
 */
export async function saveMyIntake(
  email: string,
  answers: IntakeAnswers,
  want: IntakeFormId | null = null,
): Promise<
  | { ok: true; form: IntakeFormId; savedAt: string }
  | { ok: false; error: SaveIntakeError }
> {
  const found = await intakeStageFor(email, want);
  if (!found) return { ok: false, error: { problem: "not_in_cohort" } };
  const { stage, test } = found;

  const form = await getIntakeForm(stage);
  if (form.questions.length === 0)
    return { ok: false, error: { problem: "no_questions" } };
  const checked = checkAnswers(form, answers);
  if (!checked.ok) return checked;

  // The answer is a preferred first name, kept as given. It goes in the preferred name field on their
  // record, which shows it in place of their first name; their official name is not changed.
  const nameQuestion = form.questions.find(isNameQuestion);
  const preferred = nameQuestion && checked.answers[nameQuestion.id];

  const [row] = await db
    .insert(intakeResponses)
    .values({
      form: stage,
      email: email.toLowerCase(),
      answers: checked.answers,
      test,
    })
    .returning({ submittedAt: intakeResponses.submittedAt });

  // A test answer never renames a real employee.
  if (typeof preferred === "string" && !test)
    await setChosenName(email, preferred);
  const zoneQuestion = form.questions.find(isTimezoneQuestion);
  const zone = zoneQuestion && checked.answers[zoneQuestion.id];
  if (typeof zone === "string" && !test) await setTimezone(email, zone);

  return { ok: true, form: stage, savedAt: row!.submittedAt.toISOString() };
}

/** Which of `emails`, lowercased, have saved answers to `form`. */
export async function answeredIntake(
  form: IntakeFormId,
  emails: string[],
): Promise<Set<string>> {
  if (emails.length === 0) return new Set();
  const rows = await db
    .selectDistinct({ email: intakeResponses.email })
    .from(intakeResponses)
    .where(
      and(
        eq(intakeResponses.form, form),
        inArray(intakeResponses.email, emails),
      ),
    );
  return new Set(rows.map((r) => r.email));
}

/** One form's answers someone last saved, as the Cohorts page shows them under the person. */
export type IntakeOnFile = {
  form: IntakeFormId;
  submittedAt: string;
  answers: IntakeAnswers;
};

/**
 * Each of `emails`' latest answers to each form, Pre-Bootcamp first: someone
 * at intermediate who answered both has two. Only the emails asked for, so a
 * page of the Cohorts table costs one query.
 */
export async function latestIntakesOf(
  emails: string[],
): Promise<Record<string, IntakeOnFile[]>> {
  const lower = [...new Set(emails.map((e) => e.toLowerCase()))];
  if (lower.length === 0) return {};
  const rows = await db
    .selectDistinctOn([intakeResponses.email, intakeResponses.form], {
      email: intakeResponses.email,
      form: intakeResponses.form,
      answers: intakeResponses.answers,
      submittedAt: intakeResponses.submittedAt,
    })
    .from(intakeResponses)
    .where(inArray(intakeResponses.email, lower))
    .orderBy(
      intakeResponses.email,
      intakeResponses.form,
      desc(intakeResponses.submittedAt),
    );
  const byEmail: Record<string, IntakeOnFile[]> = {};
  for (const r of rows) {
    (byEmail[r.email] ??= []).push({
      form: r.form,
      answers: r.answers,
      submittedAt: r.submittedAt.toISOString(),
    });
  }
  return byEmail;
}

/** Both forms' questions as they stand now, to label answers with. */
export async function intakeQuestionsByForm(): Promise<
  Record<IntakeFormId, IntakeForm["questions"]>
> {
  const [bootcamp, intermediate] = await Promise.all([
    getIntakeForm("bootcamp"),
    getIntakeForm("intermediate"),
  ]);
  return { bootcamp: bootcamp.questions, intermediate: intermediate.questions };
}
