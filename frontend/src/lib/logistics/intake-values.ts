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
 * asked it. Its name, time zone and dietary questions are not here: they are
 * automatic (`withAutomaticQuestions`).
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
 * Pre-Intermediate until it is first saved: no questions of its own, so it is
 * asked what every form is (`withAutomaticQuestions`) and whatever Logistics
 * settings adds. Its introduction opens with the next intermediate class's
 * dates (`withIntermediateDates`), so it keeps no dates of its own.
 */
export const DEFAULT_INTERMEDIATE_FORM: IntakeForm = {
  introduction: "",
  questions: [],
};

/** Each form until it is first saved, as the Google Forms they replace asked them. */
export const DEFAULT_INTAKE_FORMS: Record<IntakeFormId, IntakeForm> = {
  bootcamp: DEFAULT_INTAKE_FORM,
  intermediate: DEFAULT_INTERMEDIATE_FORM,
};

/**
 * The question whose answer becomes the person's preferred first name; see
 * `INTAKE_NAME_QUESTION_ID`.
 */
const NAME_QUESTION_ID = "preferred-name";

/**
 * The automatic dietary question and the answers the Dietary needs page reads,
 * on both forms. The question stores three answers: `restrictions`, every item
 * they checked; `critical`, the checked items they also marked Critical, which
 * is a subset of `restrictions`; and `other`, what they wrote in when they
 * checked "Other".
 */
export const DIETARY_KEYS = {
  restrictions: "dietary-restrictions",
  critical: "dietary-restrictions-critical",
  other: "dietary-restrictions-other",
} as const;

/** The item that asks for a write-in. */
export const DIETARY_OTHER = "Other";

/** The dietary checklist's groups, in the order the form lists them. */
export const DIETARY_GROUPS: readonly {
  label: string;
  items: readonly string[];
}[] = [
  {
    label: "Allergies",
    items: [
      "Dairy",
      "Gluten / wheat",
      "Peanuts",
      "Tree nuts",
      "Shellfish",
      "Eggs",
      "Soy",
      "Fish",
    ],
  },
  {
    label: "Dietary and religious",
    items: [
      "Vegetarian",
      "Vegan",
      "Kosher",
      "Halal",
      "Pescatarian",
      "No pork",
      "Low sodium",
      DIETARY_OTHER,
    ],
  },
];

/** Every dietary item, in the order the form lists them. */
export const DIETARY_ITEMS: readonly string[] = DIETARY_GROUPS.flatMap(
  (g) => g.items,
);

/**
 * The question whose answer becomes the person's time zone
 * (`employees.timezone`), asked as a list of every IANA zone rather than the
 * options a question stores, so it keeps none. It is automatic on both forms
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
export const INTAKE_NAME_QUESTION_ID = NAME_QUESTION_ID;

/** One name: a letter, then letters, apostrophes, hyphens or dots, as in O'Neil, Mary-Kate or St. */
const ONE_NAME = /^\p{L}[\p{L}\p{M}'’.-]*$/u;

const DAY_FORMAT = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
  timeZone: "UTC",
});

/**
 * The class's dates as its form opens with them, from its first day
 * (`YYYY-MM-DD`) and how many days it runs: it starts at 8:00AM on the first
 * and ends at 12:00PM on the last. The times and days are wrapped in `**` so
 * the form shows them in bold (`splitBold`).
 */
function classDatesLine(
  name: string,
  startDate: string,
  days: number,
): string {
  const first = new Date(`${startDate}T00:00:00Z`);
  const last = new Date(first.getTime() + (Math.max(days, 1) - 1) * 86_400_000);
  return `${name} takes place from **8:00AM ${DAY_FORMAT.format(first)}** to **12:00PM ${DAY_FORMAT.format(last)}**.`;
}

/** Pre-Bootcamp's opening line, from the next bootcamp's first day and how many days its Bootcamp class runs. */
export function bootcampDatesLine(startDate: string, btcDays: number): string {
  return classDatesLine("Bootcamp", startDate, btcDays);
}

/** Pre-Intermediate's opening line, from the next intermediate class's first day and how many days it runs, which may differ from the Bootcamp class's. */
export function intermediateDatesLine(
  startDate: string,
  intDays: number,
): string {
  return classDatesLine("Intermediate", startDate, intDays);
}

/** `introduction` led by `line`, or as it is when there is no class to give dates for. */
function withDatesLine(introduction: string, line: string | null): string {
  if (!line) return introduction;
  return introduction.trim() ? `${line}\n\n${introduction}` : line;
}

/** `introduction` led by the line giving `bootcamp`'s dates, or as it is when there is no next bootcamp. */
export function withBootcampDates(
  introduction: string,
  bootcamp: { startDate: string; btcDays: number } | null,
): string {
  return withDatesLine(
    introduction,
    bootcamp && bootcampDatesLine(bootcamp.startDate, bootcamp.btcDays),
  );
}

/** `introduction` led by the line giving the next intermediate class's dates, or as it is when there is none. */
export function withIntermediateDates(
  introduction: string,
  intermediate: { startDate: string; intDays: number } | null,
): string {
  return withDatesLine(
    introduction,
    intermediate &&
      intermediateDatesLine(intermediate.startDate, intermediate.intDays),
  );
}

/**
 * `text` cut at its `**bold**` marks: each piece, and whether it is the
 * bold one. Marks that do not pair are left as written.
 */
export function splitBold(text: string): { text: string; bold: boolean }[] {
  const parts: { text: string; bold: boolean }[] = [];
  let at = 0;
  for (const m of text.matchAll(/\*\*(.+?)\*\*/gs)) {
    if (m.index > at) parts.push({ text: text.slice(at, m.index), bold: false });
    parts.push({ text: m[1]!, bold: true });
    at = m.index + m[0].length;
  }
  if (at < text.length) parts.push({ text: text.slice(at), bold: false });
  return parts;
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
 * automatic on both forms: the form builder neither shows nor stores it.
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

/**
 * The dietary question as Pre-Bootcamp asks it of everyone: a checklist of
 * allergies and dietary or religious needs, each of which they may also mark
 * Critical, with a write-in for "Other". Optional, and automatic like the name.
 * The form shows it as its own checklist (`DIETARY_GROUPS`), so its options
 * are the flat list of items.
 */
export const DIETARY_QUESTION: IntakeQuestion = question({
  id: DIETARY_KEYS.restrictions,
  kind: "checkboxes",
  title: "Do you have any dietary restrictions or allergies we should plan for?",
  description:
    "Check all that apply. Also check \u201cCritical\u201d if it's a medical need, such as a severe allergy.",
  required: false,
  options: [...DIETARY_ITEMS],
});

/** Whether `q` is the dietary question, whose answers are the three in `DIETARY_KEYS`. */
export function isDietaryQuestion(
  q: Pick<IntakeQuestion, "id" | "kind">,
): boolean {
  return q.id === DIETARY_KEYS.restrictions && q.kind === "checkboxes";
}

/** Whether `q` is one of the automatic questions, which no form saves. */
function isAutomatic(q: Pick<IntakeQuestion, "id">): boolean {
  return (
    q.id === INTAKE_NAME_QUESTION_ID ||
    q.id === INTAKE_TIMEZONE_QUESTION_ID ||
    q.id === DIETARY_KEYS.restrictions
  );
}

/** `questions` as the form builder keeps them: the automatic questions taken out, whatever was saved or sent. */
export function withoutAutomaticQuestions(
  _form: IntakeFormId,
  questions: IntakeQuestion[],
): IntakeQuestion[] {
  return questions.filter((q) => !isAutomatic(q));
}

/**
 * `questions` as a form asks them: led by the name, time zone and dietary
 * questions, as every form is, then the form's own.
 */
export function withAutomaticQuestions(
  form: IntakeFormId,
  questions: IntakeQuestion[],
): IntakeQuestion[] {
  return [
    PREFERRED_NAME_QUESTION,
    TIMEZONE_QUESTION,
    DIETARY_QUESTION,
    ...withoutAutomaticQuestions(form, questions),
  ];
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
  DIETARY_KEYS.restrictions,
  DIETARY_KEYS.critical,
  DIETARY_KEYS.other,
] as const;

/** `answers` cut down to what `CARRIED_TO_INTERMEDIATE` carries, for the questions `form` asks. */
export function carriedAnswers(
  form: IntakeForm,
  answers: IntakeAnswers,
): IntakeAnswers {
  const asked = new Set(form.questions.map((q) => q.id));
  const kept: IntakeAnswers = {};
  for (const id of CARRIED_TO_INTERMEDIATE) {
    // The critical marks and the write-in are asked with the checklist.
    if (asked.has(DIETARY_KEYS.restrictions) && answers[id] !== undefined)
      kept[id] = answers[id]!;
  }
  return kept;
}

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

/** The trimmed, non-blank values of an answer, whether it came as one string or a list. */
function valuesOf(raw: string | string[] | undefined): string[] {
  return (Array.isArray(raw) ? raw : raw === undefined ? [] : [raw])
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

/**
 * The dietary question's three answers as they will be stored: items in the
 * checklist's order without repeats, the critical ones only if they are among
 * them, and the write-in only if "Other" is checked, where it is required.
 * An item outside the checklist, or a critical mark on one not checked, is
 * `not_an_option`.
 */
function checkDietary(
  q: IntakeQuestion,
  answers: IntakeAnswers,
): { ok: true; answers: IntakeAnswers } | { ok: false; error: AnswerProblem } {
  const bad = (problem: AnswerProblem["problem"]) => ({
    ok: false as const,
    error: { questionId: q.id, problem },
  });
  const checked = new Set(valuesOf(answers[DIETARY_KEYS.restrictions]));
  const marked = new Set(valuesOf(answers[DIETARY_KEYS.critical]));
  const other = valuesOf(answers[DIETARY_KEYS.other]);
  if (
    [...checked].some((v) => !DIETARY_ITEMS.includes(v)) ||
    [...marked].some((v) => !checked.has(v)) ||
    other.length > 1
  )
    return bad("not_an_option");

  const kept: IntakeAnswers = {};
  const items = DIETARY_ITEMS.filter((v) => checked.has(v));
  if (items.length === 0) {
    return q.required ? bad("required") : { ok: true, answers: kept };
  }
  kept[DIETARY_KEYS.restrictions] = items;
  const critical = items.filter((v) => marked.has(v));
  if (critical.length > 0) kept[DIETARY_KEYS.critical] = critical;
  if (checked.has(DIETARY_OTHER)) {
    if (other.length === 0) return bad("required");
    kept[DIETARY_KEYS.other] = other[0]!;
  }
  return { ok: true, answers: kept };
}

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
    if (isDietaryQuestion(q)) {
      const dietary = checkDietary(q, answers);
      if (!dietary.ok) return dietary;
      Object.assign(kept, dietary.answers);
      continue;
    }
    const values = valuesOf(answers[q.id]);

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
