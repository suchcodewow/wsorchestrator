/**
 * The logistics intake forms' shape, their default questions, and the checks
 * on an attendee's answers. Pure, so the editor, the form at /intake and the
 * unit suite share them with the routes.
 */

import { z } from "zod";
import { isTimeZone } from "@/lib/timezones";
import {
  INTAKE_FORM_IDS,
  INTAKE_LIMITS,
  INTAKE_QUESTION_KINDS,
  type IntakeFormId,
  type IntakeQuestion,
  type IntakeQuestionKind,
} from "@/db/schema";

/** A form as Logistics settings edits it: the text above its first question, then its questions. */
export type IntakeForm = { introduction: string; questions: IntakeQuestion[] };

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

/** What the Responses tab lists: one form, or `all` for both together. */
export type ResponsesForm = IntakeFormId | "all";

/** The `form` a Responses URL asks for; Pre-Bootcamp for one that asks none, or anything else. */
export function responsesFormOf(value: unknown): ResponsesForm {
  return value === "all" || isIntakeFormId(value) ? value : "bootcamp";
}

/**
 * Both forms' questions for listing their responses together: Pre-Bootcamp's,
 * then those only Pre-Intermediate asks. A question both ask, such as the
 * dietary ones, is one column, under Pre-Bootcamp's wording.
 */
export function questionsOfBoth(
  bootcamp: IntakeQuestion[],
  intermediate: IntakeQuestion[],
): IntakeQuestion[] {
  const ids = new Set(bootcamp.map((q) => q.id));
  return [...bootcamp, ...intermediate.filter((q) => !ids.has(q.id))];
}

/** Slack's mrkdwn treats these three as markup. */
const slackEscape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The Slack message someone yet to answer `form` is sent, greeting them by their first name. */
export function intakeReminderText(
  fullName: string,
  form: IntakeFormId,
  link: string,
): string {
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
export const HAS_OPTIONS: ReadonlySet<IntakeQuestionKind> = new Set([
  "choice",
  "checkboxes",
  "dropdown",
]);

/** The kinds that may offer a free-text "Other". */
export const HAS_OTHER: ReadonlySet<IntakeQuestionKind> = new Set([
  "choice",
  "checkboxes",
]);

const question = (
  q: Omit<IntakeQuestion, "description" | "options" | "other"> &
    Partial<IntakeQuestion>,
): IntakeQuestion => ({
  description: "",
  options: [],
  other: false,
  ...q,
});

/** The name question as Pre-Bootcamp asks it; the migration that put it on saved forms spells it the same. */
export const PREFERRED_NAME_TITLE =
  "Do you have a preferred name you would like classmates and instructors to use?";

/**
 * The November 2026 Sales Bootcamp registration, as the Google Form it replaces
 * asked it. Its name and time zone questions are not here: they are automatic
 * (`withAutomaticQuestions`).
 */
export const DEFAULT_INTAKE_FORM: IntakeForm = {
  introduction:
    'Sales Bootcamp takes place from Tuesday November 17 through Friday November 20 in Dallas, Texas.\n\n1) We strictly enforce an "All or Nothing" model where every person must attend the entirety of Bootcamp, no exceptions, even for customer meetings.\n\n2) You will not be able to step out for any reason during Bootcamp sessions throughout the day.\n\n3) If you already know that you will be on PTO any of the days between November 17-20 you should mark "No" in this form.\n\n4) If you\'re traveling from EMEA or APAC, you are allowed to arrive on Monday Nov 16th to adjust to the time zone prior to Bootcamp Day 1. We recommend you do so if your schedule permits; we want you to be fresh and ready come Tuesday morning.\n\n5) No departure flights before 2:00PM PST on Friday, Nov 20th.\n\nPlease discuss with your manager if anything above may prevent you from attending Bootcamp.',
  questions: [
    question({
      id: "attend",
      kind: "choice",
      title:
        "Sales Bootcamp takes place in-person in Dallas November 17th - 20th. Will you attend?",
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
      title:
        "Any other concerns or special considerations we should be aware of? Write them in here.",
      description:
        "If you have received a copy of the Harness Value Framework please bring it to training. If not, we will provide you with one.\n\nYou will need to pass a Bootcamp entry exam, so make sure to complete your pre-work in advance to prepare!",
      required: false,
    }),
    question({
      id: "command-of-the-message",
      kind: "choice",
      title:
        "Have you gone through Force Management's Command of the Message training before?",
      required: false,
      options: ["Yes", "No", "I'm not sure"],
    }),
  ],
};

/**
 * The November 2026 Intermediate registration, as the Google Form it replaces
 * asked it. It stays the same from cohort to cohort but for its dates. Its
 * dietary questions keep Pre-Bootcamp's ids, so the Logistics page reads both
 * forms' answers as one list; it asks no name, so its people are listed under
 * the name the app has for them.
 */
export const DEFAULT_INTERMEDIATE_FORM: IntakeForm = {
  introduction:
    'Intermediate Training takes place on November 17 - 19 in Dallas, Texas.\n\n1) We strictly enforce an "All or Nothing" model where every person must attend all of Intermediate, no exceptions, even for customer meetings.\n\n2) You will not be able to step out for any reason during Intermediate sessions throughout the day.\n\n3) If you already know that you will be on PTO any of the days between November 17 -20 you should mark "No" in this form.\n\n4) If you\'re traveling from EMEA or APAC, you are allowed to arrive on Sunday November 15th to adjust to the time zone prior to Intermediate Day 1. We recommend you do so if your schedule permits; we want you to be fresh and ready come Tuesday morning. We also understand many may not have flight options available Wednesday evening, so please mark on the form exactly which nights you will need a hotel for.\n\n5) No departure flights before 2PM PST on Thursday, November 19.\n\nPlease discuss with your manager if anything above may prevent you from attending Intermediate.\n\nAlso, please input accurate responses below as they help us plan our agenda, hotel blocks, and catered meals.',
  questions: [
    question({
      id: "attend",
      kind: "choice",
      title:
        "Intermediate takes place in-person on November 17 - 19, will you be there",
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
      kind: "paragraph",
      title:
        "On a scale of 1 to 5, how critical are your dietary/allergy needs?",
      required: false,
    }),
    question({
      id: "concerns",
      kind: "short",
      title:
        "Any other concerns or special considerations we should be aware of? Write them in here.",
      description:
        "If you have received a copy of the Harness Value Framework V2.0 please bring it to training. If not, we will provide you with one.\n\nYou will need to pass an Intermediate entrance exam, so make sure to complete your pre-work in advance to prepare!",
      required: false,
    }),
  ],
};

/** Each form until it is first saved, as the Google Forms they replace asked them. */
export const DEFAULT_INTAKE_FORMS: Record<IntakeFormId, IntakeForm> = {
  bootcamp: DEFAULT_INTAKE_FORM,
  intermediate: DEFAULT_INTERMEDIATE_FORM,
};

/**
 * The questions the Logistics page reads dietary needs from, on both forms.
 * Editing their wording keeps them; removing one and adding another in its
 * place does not, since the new question gets a new id.
 */
export const DIETARY_QUESTION_IDS = {
  has: "dietary",
  needs: "dietary-needs",
  critical: "dietary-critical",
  name: "preferred-name",
} as const;

/**
 * The question whose answer becomes the person's time zone
 * (`employees.timezone`), asked as a list of every IANA zone rather than the
 * options a question stores, so it keeps none. It is automatic on Pre-Bootcamp
 * like the name question, and starts from the zone the app already has for them.
 */
export const INTAKE_TIMEZONE_QUESTION_ID = "timezone";

/**
 * The question whose answer becomes the person's name across the app — on
 * their employee record, name cards and everywhere else — rather than only an
 * answer. It is a preferred first name (`isFirstName`), which replaces the
 * first name on their record and keeps their last (`preferredFullName`), and
 * starts from the preferred name they already have. Only a short or paragraph
 * question with this id counts.
 */
export const INTAKE_NAME_QUESTION_ID = DIETARY_QUESTION_IDS.name;

/** One name: a letter, then letters, apostrophes, hyphens or dots, as in O'Neil, Mary-Kate or St. */
const ONE_NAME = /^\p{L}[\p{L}\p{M}'’.-]*$/u;

const DAY_FORMAT = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
  timeZone: "UTC",
});

/**
 * The line Pre-Bootcamp opens with, from the next bootcamp's first day
 * (`YYYY-MM-DD`) and how many days its Bootcamp class runs: it starts at
 * 8:00AM on the first and ends at 12:00PM on the last.
 */
export function bootcampDatesLine(startDate: string, btcDays: number): string {
  const first = new Date(`${startDate}T00:00:00Z`);
  const last = new Date(
    first.getTime() + (Math.max(btcDays, 1) - 1) * 86_400_000,
  );
  return `Bootcamp takes place from 8:00AM ${DAY_FORMAT.format(first)} to 12:00PM ${DAY_FORMAT.format(last)}.`;
}

/** `introduction` led by the line giving `bootcamp`'s dates, or as it is when there is no next bootcamp. */
export function withBootcampDates(
  introduction: string,
  bootcamp: { startDate: string; btcDays: number } | null,
): string {
  if (!bootcamp) return introduction;
  const dates = bootcampDatesLine(bootcamp.startDate, bootcamp.btcDays);
  return introduction.trim() ? `${dates}\n\n${introduction}` : dates;
}

/** A name as it is stored: trimmed, with runs of spaces closed up to one. */
export function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/** Whether `value`, once normalized, is one name, a first name, with no space in it. */
export function isFirstName(value: string): boolean {
  return ONE_NAME.test(normalizeName(value));
}

/**
 * The name the app shows for someone whose name on record is `legal` and who
 * prefers `first`: their first name replaced, their last name kept. A name on
 * record of one word has no last name to keep.
 */
export function preferredFullName(legal: string, first: string): string {
  const [, ...rest] = normalizeName(legal).split(" ");
  return normalizeName([first, ...rest].join(" "));
}

/** The first name in `name`, which is all the name question holds: the answer as it was given, or one saved as a full name. */
export function firstNameOf(name: string): string {
  return normalizeName(name).split(" ")[0] ?? "";
}

/**
 * The name question as Pre-Bootcamp asks it of everyone: optional, a first
 * name only, and left blank unless they already have a preferred name. It is
 * automatic: the form builder neither shows nor stores it.
 */
export const PREFERRED_NAME_QUESTION: IntakeQuestion = question({
  id: INTAKE_NAME_QUESTION_ID,
  kind: "short",
  title: PREFERRED_NAME_TITLE,
  required: false,
});

/** The time zone question as Pre-Bootcamp asks it of everyone, a list of every zone to confirm. Automatic, like the name. */
export const TIMEZONE_QUESTION: IntakeQuestion = question({
  id: INTAKE_TIMEZONE_QUESTION_ID,
  kind: "dropdown",
  title: "Please confirm the time zone you normally work in.",
  required: true,
});

/** Whether `q` is the time zone question, whose answer is the person's time zone. */
export function isTimezoneQuestion(
  q: Pick<IntakeQuestion, "id" | "kind">,
): boolean {
  return q.id === INTAKE_TIMEZONE_QUESTION_ID && q.kind === "dropdown";
}

/** Whether `q` is one of Pre-Bootcamp's automatic questions, which no form saves. */
function isAutomatic(q: Pick<IntakeQuestion, "id">): boolean {
  return (
    q.id === INTAKE_NAME_QUESTION_ID || q.id === INTAKE_TIMEZONE_QUESTION_ID
  );
}

/** `questions` as the form builder keeps them: Pre-Bootcamp's automatic questions taken out, whatever was saved or sent. */
export function withoutAutomaticQuestions(
  form: IntakeFormId,
  questions: IntakeQuestion[],
): IntakeQuestion[] {
  return form === "bootcamp"
    ? questions.filter((q) => !isAutomatic(q))
    : questions;
}

/**
 * `questions` as a form asks them: Pre-Bootcamp's led by the name and time
 * zone questions, as they always are, then the form's own.
 */
export function withAutomaticQuestions(
  form: IntakeFormId,
  questions: IntakeQuestion[],
): IntakeQuestion[] {
  return form === "bootcamp"
    ? [
        PREFERRED_NAME_QUESTION,
        TIMEZONE_QUESTION,
        ...withoutAutomaticQuestions(form, questions),
      ]
    : questions;
}

/** Whether `q` is the name question, so its answer is the person's name. */
export function isNameQuestion(
  q: Pick<IntakeQuestion, "id" | "kind">,
): boolean {
  return (
    q.id === INTAKE_NAME_QUESTION_ID &&
    (q.kind === "short" || q.kind === "paragraph")
  );
}

/**
 * The answers Pre-Intermediate starts from when someone has none of its own
 * yet but answered Pre-Bootcamp, usually a cohort or two before: their
 * dietary needs, which last. What is about one cohort, such as whether they
 * will attend, starts blank. Only a question on both forms is carried.
 */
export const CARRIED_TO_INTERMEDIATE = [
  DIETARY_QUESTION_IDS.has,
  DIETARY_QUESTION_IDS.needs,
  DIETARY_QUESTION_IDS.critical,
] as const;

/** `answers` cut down to what `CARRIED_TO_INTERMEDIATE` carries, for the questions `form` asks. */
export function carriedAnswers(
  form: IntakeForm,
  answers: IntakeAnswers,
): IntakeAnswers {
  const asked = new Set(form.questions.map((q) => q.id));
  const kept: IntakeAnswers = {};
  for (const id of CARRIED_TO_INTERMEDIATE) {
    if (asked.has(id) && answers[id] !== undefined) kept[id] = answers[id]!;
  }
  return kept;
}

/** How critical a dietary need is, 1 to 5; 5 is an allergy or a religious restriction. */
export const DIETARY_LEVELS = [5, 4, 3, 2, 1] as const;

const questionSchema = z
  .object({
    id: z.string().trim().min(1).max(64),
    kind: z.enum(INTAKE_QUESTION_KINDS),
    title: z.string().trim().min(1).max(INTAKE_LIMITS.title),
    description: z.string().max(INTAKE_LIMITS.description).default(""),
    required: z.boolean().default(false),
    options: z
      .array(z.string().trim().min(1).max(INTAKE_LIMITS.option))
      .max(INTAKE_LIMITS.options)
      .default([]),
    other: z.boolean().default(false),
  })
  .strict()
  .transform((q) => ({
    ...q,
    options: HAS_OPTIONS.has(q.kind) ? q.options : [],
    other: HAS_OTHER.has(q.kind) && q.other,
  }))
  .refine(
    (q) =>
      !HAS_OPTIONS.has(q.kind) || q.options.length > 0 || isTimezoneQuestion(q),
    "a list question needs an option",
  )
  .refine(
    (q) => new Set(q.options).size === q.options.length,
    "options repeat",
  );

export const intakeFormSchema = z
  .object({
    introduction: z.string().max(INTAKE_LIMITS.introduction).default(""),
    questions: z.array(questionSchema).max(INTAKE_LIMITS.questions),
  })
  .strict()
  .refine(
    (f) => new Set(f.questions.map((q) => q.id)).size === f.questions.length,
    "question ids repeat",
  );

/** Someone's answers to their own form; who they are is their sign-in, never something they type. */
export const intakeSubmissionSchema = z
  .object({
    answers: z.record(
      z.union([
        z.string().max(INTAKE_LIMITS.answer),
        z
          .array(z.string().max(INTAKE_LIMITS.answer))
          .max(INTAKE_LIMITS.options + 1),
      ]),
    ),
  })
  .strict();

export type IntakeAnswers = Record<string, string | string[]>;

/** `not_a_name`: the name question's answer is not a single first name (`isFirstName`). */
export type AnswerProblem = {
  questionId: string;
  problem: "required" | "not_an_option" | "not_a_name";
};

/**
 * The answers as they will be stored — trimmed, blanks dropped, and only for
 * questions on the form — or the first question that is wrong. An answer
 * outside a list's options passes only where the question offers "Other",
 * and the name question's must be a single first name.
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
      if (q.required)
        return { ok: false, error: { questionId: q.id, problem: "required" } };
      continue;
    }

    if (isTimezoneQuestion(q)) {
      if (values.length > 1 || !isTimeZone(values[0]))
        return {
          ok: false,
          error: { questionId: q.id, problem: "not_an_option" },
        };
    } else if (HAS_OPTIONS.has(q.kind)) {
      const outside = values.filter((v) => !q.options.includes(v));
      const single = q.kind !== "checkboxes";
      if ((single && values.length > 1) || outside.length > (q.other ? 1 : 0)) {
        return {
          ok: false,
          error: { questionId: q.id, problem: "not_an_option" },
        };
      }
    } else if (values.length > 1) {
      return {
        ok: false,
        error: { questionId: q.id, problem: "not_an_option" },
      };
    } else if (isNameQuestion(q)) {
      if (!isFirstName(values[0]!))
        return {
          ok: false,
          error: { questionId: q.id, problem: "not_a_name" },
        };
      values[0] = normalizeName(values[0]!);
    }

    kept[q.id] = q.kind === "checkboxes" ? values : values[0]!;
  }
  return { ok: true, answers: kept };
}
