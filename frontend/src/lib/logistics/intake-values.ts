/**
 * The logistics intake forms' shape, their default questions, and the checks
 * on an attendee's answers. Pure, so the editor, the form at /intake and the
 * unit suite share them with the routes.
 */

import { z } from "zod";
import {
  INTAKE_FORM_IDS,
  INTAKE_LIMITS,
  INTAKE_QUESTION_KINDS,
  type IntakeFormId,
  type IntakeQuestion,
  type IntakeQuestionKind,
} from "@/db/schema";

export type IntakeForm = { questions: IntakeQuestion[] };

/** Each form's name in Logistics settings; the stage of the current cohort it is named for is the one asked it. */
export const INTAKE_FORM_LABELS: Record<IntakeFormId, string> = {
  bootcamp: "Pre-Bootcamp",
  intermediate: "Pre-Intermediate",
};

/** What each form is called where it is filled in, at /intake and in its Slack reminder. */
export const INTAKE_FORM_HEADINGS: Record<IntakeFormId, string> = {
  bootcamp: "Bootcamp Registration",
  intermediate: "Intermediate Registration",
};

export function isIntakeFormId(value: unknown): value is IntakeFormId {
  return INTAKE_FORM_IDS.includes(value as IntakeFormId);
}

/** Slack's mrkdwn treats these three as markup. */
const slackEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The Slack message someone yet to answer `form` is sent, greeting them by their first name. */
export function intakeReminderText(fullName: string, form: IntakeFormId, link: string): string {
  const first = fullName.trim().split(/\s+/)[0];
  const hello = first ? `Hi ${slackEscape(first)}!` : "Hi!";
  return `${hello} You haven't filled in your *${INTAKE_FORM_HEADINGS[form]}* yet. It only takes a few minutes: <${link}|complete it here>.`;
}

export const KIND_LABELS: Record<IntakeQuestionKind, string> = {
  short: "Short answer",
  paragraph: "Paragraph",
  choice: "Multiple choice",
  checkboxes: "Checkboxes",
  dropdown: "Dropdown",
};

/** The kinds an attendee picks from a list of options. */
export const HAS_OPTIONS: ReadonlySet<IntakeQuestionKind> = new Set(["choice", "checkboxes", "dropdown"]);

/** The kinds that may offer a free-text "Other". */
export const HAS_OTHER: ReadonlySet<IntakeQuestionKind> = new Set(["choice", "checkboxes"]);

const question = (q: Omit<IntakeQuestion, "description" | "options" | "other"> & Partial<IntakeQuestion>): IntakeQuestion => ({
  description: "",
  options: [],
  other: false,
  ...q,
});

/** The November 2026 Sales Bootcamp registration, as the Google Form it replaces asked it. */
export const DEFAULT_INTAKE_FORM: IntakeForm = {
  questions: [
    question({
      id: "attend",
      kind: "choice",
      title: "Sales Bootcamp takes place in-person in Dallas November 17th - 20th. Will you attend?",
      required: false,
      options: ["Yes - I'm there!", "No - I can't make it."],
      other: true,
    }),
    question({
      id: "dietary",
      kind: "dropdown",
      title:
        "Are there any dietary restrictions that we should try to accommodate? (check yes for vegetarian, vegan, allergies, etc. and describe in the following field)",
      required: true,
      options: ["Yes", "No"],
    }),
    question({
      id: "dietary-needs",
      kind: "paragraph",
      title: "If yes, please describe your dietary needs.",
      required: false,
    }),
    question({
      id: "dietary-critical",
      kind: "short",
      title: "On a scale of 1 to 5, how critical are your dietary needs",
      required: true,
    }),
    question({
      id: "concerns",
      kind: "short",
      title: "Any other concerns or special considerations we should be aware of? Write them in here.",
      description:
        "If you have received a copy of the Harness Value Framework please bring it to training. If not, we will provide you with one.\n\nYou will need to pass a Bootcamp entry exam, so make sure to complete your pre-work in advance to prepare!",
      required: false,
    }),
    question({
      id: "command-of-the-message",
      kind: "choice",
      title: "Have you gone through Force Management's Command of the Message training before?",
      required: false,
      options: ["Yes", "No", "I'm not sure"],
    }),
    question({
      id: "preferred-name",
      kind: "short",
      title: "What name would you like instructors and classmates to use?",
      required: true,
    }),
  ],
};

/** Each form until it is first saved: Pre-Bootcamp as the Google Form asked it, Pre-Intermediate with nothing to ask yet. */
export const DEFAULT_INTAKE_FORMS: Record<IntakeFormId, IntakeForm> = {
  bootcamp: DEFAULT_INTAKE_FORM,
  intermediate: { questions: [] },
};

/**
 * The Pre-Bootcamp form's questions the Logistics page reads dietary needs from.
 * Editing their wording keeps them; removing one and adding another in its
 * place does not, since the new question gets a new id.
 */
export const DIETARY_QUESTION_IDS = {
  has: "dietary",
  needs: "dietary-needs",
  critical: "dietary-critical",
  name: "preferred-name",
} as const;

/** How critical a dietary need is, 1 to 5; 5 is an allergy or a religious restriction. */
export const DIETARY_LEVELS = [5, 4, 3, 2, 1] as const;

const questionSchema = z
  .object({
    id: z.string().trim().min(1).max(64),
    kind: z.enum(INTAKE_QUESTION_KINDS),
    title: z.string().trim().min(1).max(INTAKE_LIMITS.title),
    description: z.string().max(INTAKE_LIMITS.description).default(""),
    required: z.boolean().default(false),
    options: z.array(z.string().trim().min(1).max(INTAKE_LIMITS.option)).max(INTAKE_LIMITS.options).default([]),
    other: z.boolean().default(false),
  })
  .strict()
  .transform((q) => ({
    ...q,
    options: HAS_OPTIONS.has(q.kind) ? q.options : [],
    other: HAS_OTHER.has(q.kind) && q.other,
  }))
  .refine((q) => !HAS_OPTIONS.has(q.kind) || q.options.length > 0, "a list question needs an option")
  .refine((q) => new Set(q.options).size === q.options.length, "options repeat");

export const intakeFormSchema = z
  .object({
    questions: z.array(questionSchema).max(INTAKE_LIMITS.questions),
  })
  .strict()
  .refine((f) => new Set(f.questions.map((q) => q.id)).size === f.questions.length, "question ids repeat");

/** Someone's answers to their own form; who they are is their sign-in, never something they type. */
export const intakeSubmissionSchema = z
  .object({
    answers: z.record(
      z.union([
        z.string().max(INTAKE_LIMITS.answer),
        z.array(z.string().max(INTAKE_LIMITS.answer)).max(INTAKE_LIMITS.options + 1),
      ]),
    ),
  })
  .strict();

export type IntakeAnswers = Record<string, string | string[]>;

export type AnswerProblem = { questionId: string; problem: "required" | "not_an_option" };

/**
 * The answers as they will be stored — trimmed, blanks dropped, and only for
 * questions on the form — or the first question that is wrong. An answer
 * outside a list's options passes only where the question offers "Other".
 */
export function checkAnswers(
  form: IntakeForm,
  answers: IntakeAnswers,
): { ok: true; answers: IntakeAnswers } | { ok: false; error: AnswerProblem } {
  const kept: IntakeAnswers = {};
  for (const q of form.questions) {
    const raw = answers[q.id];
    const values = (Array.isArray(raw) ? raw : raw === undefined ? [] : [raw])
      .map((v) => v.trim())
      .filter((v) => v.length > 0);

    if (values.length === 0) {
      if (q.required) return { ok: false, error: { questionId: q.id, problem: "required" } };
      continue;
    }

    if (HAS_OPTIONS.has(q.kind)) {
      const outside = values.filter((v) => !q.options.includes(v));
      const single = q.kind !== "checkboxes";
      if ((single && values.length > 1) || outside.length > (q.other ? 1 : 0)) {
        return { ok: false, error: { questionId: q.id, problem: "not_an_option" } };
      }
    } else if (values.length > 1) {
      return { ok: false, error: { questionId: q.id, problem: "not_an_option" } };
    }

    kept[q.id] = q.kind === "checkboxes" ? values : values[0]!;
  }
  return { ok: true, answers: kept };
}
