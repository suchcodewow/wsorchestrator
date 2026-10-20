/**
 * Everything someone has been asked to fill in, as /intake lists it: their
 * stage's registration form, and each daily survey sent to them. The ones
 * they have yet to answer come first.
 */

import "server-only";

import type { IntakeFormId } from "@/db/schema";
import { getMyIntake } from "@/lib/logistics/intake";
import { listMySurveys } from "@/lib/surveys/surveys";
import { SURVEY_STAGE_LABELS, surveyDate } from "@/lib/surveys/survey-values";

export type MyForm = {
  kind: "registration" | "survey";
  /** The registration form's stage, or the survey's id. */
  id: string;
  title: string;
  /** What it is about: "Bootcamp · Tuesday, November 17 · 2 sessions". */
  detail: string;
  href: string;
  /** When it was answered; null while it is still to do. */
  completedAt: string | null;
};

/** `email`'s forms and surveys, the unanswered first, each half in the order to do or review them. */
export async function listMyForms(email: string): Promise<MyForm[]> {
  const [intake, surveys] = await Promise.all([getMyIntake(email), listMySurveys(email)]);

  const forms: MyForm[] = [];
  if (intake) {
    // A test group member in both stages has both forms; everyone else has their stage's.
    const stages: IntakeFormId[] = intake.testForms ?? [intake.form];
    for (const stage of stages) {
      const mine = stage === intake.form ? intake : await getMyIntake(email, stage);
      if (!mine || mine.questions.length === 0) continue;
      forms.push({
        kind: "registration",
        id: stage,
        title: mine.heading,
        detail: `${mine.questions.length} ${mine.questions.length === 1 ? "question" : "questions"}`,
        href: intake.testForms ? `/intake/registration?form=${stage}` : "/intake/registration",
        completedAt: mine.savedAt,
      });
    }
  }
  for (const s of surveys) {
    forms.push({
      kind: "survey",
      id: s.id,
      title: `Day ${s.day} Survey`,
      detail: `${SURVEY_STAGE_LABELS[s.stage]} · ${surveyDate(s.date)} · ${s.sessions} ${s.sessions === 1 ? "session" : "sessions"}`,
      href: `/intake/surveys/${s.id}`,
      completedAt: s.submittedAt,
    });
  }

  const todo = forms.filter((f) => !f.completedAt);
  const done = forms
    .filter((f) => f.completedAt)
    .sort((x, y) => y.completedAt!.localeCompare(x.completedAt!));
  return [...todo, ...done];
}
