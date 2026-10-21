/**
 * The logistics intake forms: what an administrator may save, which answers
 * are kept, and the Slack reminder sent to someone yet to give them. The
 * server checks answers against the form as it stands when they arrive, so
 * these are the only rules between a signed-in PUT and the table.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_INTAKE_FORM,
  DEFAULT_INTAKE_FORMS,
  PREFERRED_NAME_TITLE,
  DIETARY_ITEMS,
  DIETARY_KEYS,
  DIETARY_OTHER,
  DIETARY_QUESTION,
  isDietaryQuestion,
  bootcampDatesLine,
  intermediateDatesLine,
  withBootcampDates,
  withIntermediateDates,
  splitBold,
  CARRIED_TO_INTERMEDIATE,
  carriedAnswers,
  questionsOfBoth,
  responsesFormOf,
  INTAKE_NAME_QUESTION_ID,
  PREFERRED_NAME_QUESTION,
  TIMEZONE_QUESTION,
  INTAKE_TIMEZONE_QUESTION_ID,
  isTimezoneQuestion,
  checkAnswers,
  withAutomaticQuestions,
  withoutAutomaticQuestions,
  intakeReminderText,
  isFirstName,
  firstNameOf,
  preferredFullName,
  isNameQuestion,
  normalizeName,
  intakeFormSchema,
  intakeSubmissionSchema,
  type IntakeForm,
} from "@/lib/logistics/intake-values";

const FORM: IntakeForm = {
  introduction: "",
  questions: [
    {
      id: "name",
      kind: "short",
      title: "Name",
      description: "",
      required: true,
      options: [],
      other: false,
    },
    {
      id: "notes",
      kind: "paragraph",
      title: "Notes",
      description: "",
      required: false,
      options: [],
      other: false,
    },
    {
      id: "attend",
      kind: "choice",
      title: "Attend?",
      description: "",
      required: false,
      options: ["Yes", "No"],
      other: true,
    },
    {
      id: "diet",
      kind: "dropdown",
      title: "Diet?",
      description: "",
      required: false,
      options: ["Yes", "No"],
      other: false,
    },
    {
      id: "langs",
      kind: "checkboxes",
      title: "Languages",
      description: "",
      required: false,
      options: ["Go", "Rust"],
      other: false,
    },
  ],
};

describe("the default form", () => {
  test("is one the editor could have saved", () => {
    assert.ok(intakeFormSchema.safeParse(DEFAULT_INTAKE_FORM).success);
  });

  test("asks the Google Form's questions, none of them required, and not the automatic name, time zone and dietary checklist", () => {
    assert.equal(DEFAULT_INTAKE_FORM.questions.length, 3);
    assert.deepEqual(
      DEFAULT_INTAKE_FORM.questions.filter((q) => q.required).map((q) => q.id),
      [],
    );
    assert.deepEqual(
      withoutAutomaticQuestions("bootcamp", DEFAULT_INTAKE_FORM.questions),
      DEFAULT_INTAKE_FORM.questions,
    );
  });

  test("is Pre-Bootcamp's, with the Google Form's introduction", () => {
    assert.equal(DEFAULT_INTAKE_FORMS.bootcamp, DEFAULT_INTAKE_FORM);
    assert.ok(intakeFormSchema.safeParse(DEFAULT_INTAKE_FORM).success);
    assert.match(
      DEFAULT_INTAKE_FORM.introduction,
      /^Sales Bootcamp takes place from Tuesday November 17/,
    );
    assert.match(DEFAULT_INTAKE_FORM.introduction, /"All or Nothing"/);
  });
});

describe("the Pre-Bootcamp dates line", () => {
  test("runs from 8:00AM the first day to 12:00PM the last, for the days the class runs", () => {
    assert.equal(
      bootcampDatesLine("2026-11-17", 4),
      "Bootcamp takes place from **8:00AM Tuesday, November 17** to **12:00PM Friday, November 20**.",
    );
  });

  test("is one day long when the class runs one day or the count is missing", () => {
    const one =
      "Bootcamp takes place from **8:00AM Tuesday, November 17** to **12:00PM Tuesday, November 17**.";
    assert.equal(bootcampDatesLine("2026-11-17", 1), one);
    assert.equal(bootcampDatesLine("2026-11-17", 0), one);
  });

  test("crosses a month end", () => {
    assert.equal(
      bootcampDatesLine("2026-11-30", 3),
      "Bootcamp takes place from **8:00AM Monday, November 30** to **12:00PM Wednesday, December 2**.",
    );
  });

  test("leads the introduction, and stands alone without one or without a next bootcamp", () => {
    const next = { startDate: "2026-11-17", btcDays: 4 };
    const line = bootcampDatesLine(next.startDate, next.btcDays);
    assert.equal(withBootcampDates("Welcome.", next), `${line}\n\nWelcome.`);
    assert.equal(withBootcampDates("  ", next), line);
    assert.equal(withBootcampDates("Welcome.", null), "Welcome.");
  });
});

describe("the Pre-Intermediate dates line", () => {
  test("runs from 8:00AM the bootcamp's first day to 12:00PM the last day of the Intermediate class, which can end sooner", () => {
    assert.equal(
      intermediateDatesLine("2026-11-17", 2),
      "Intermediate takes place from **8:00AM Tuesday, November 17** to **12:00PM Wednesday, November 18**.",
    );
    assert.equal(
      intermediateDatesLine("2026-11-17", 3),
      "Intermediate takes place from **8:00AM Tuesday, November 17** to **12:00PM Thursday, November 19**.",
    );
  });

  test("leads the introduction, and stands alone without one or without a next class", () => {
    const next = { startDate: "2026-11-17", intDays: 3 };
    const line = intermediateDatesLine(next.startDate, next.intDays);
    assert.equal(
      withIntermediateDates("Welcome.", next),
      `${line}\n\nWelcome.`,
    );
    assert.equal(withIntermediateDates("", next), line);
    assert.equal(withIntermediateDates("Welcome.", null), "Welcome.");
  });
});

describe("bold markup", () => {
  test("splits text wrapped in double asterisks from the rest", () => {
    assert.deepEqual(
      splitBold("Starts **8:00AM Tuesday** and ends **noon**."),
      [
        { text: "Starts ", bold: false },
        { text: "8:00AM Tuesday", bold: true },
        { text: " and ends ", bold: false },
        { text: "noon", bold: true },
        { text: ".", bold: false },
      ],
    );
  });

  test("leaves plain text, and an unmatched marker, as written", () => {
    assert.deepEqual(splitBold("Plain."), [{ text: "Plain.", bold: false }]);
    assert.equal(
      splitBold("a ** b")
        .map((part) => part.text)
        .join(""),
      "a ** b",
    );
  });
});

describe("the default Pre-Intermediate form", () => {
  const form = DEFAULT_INTAKE_FORMS.intermediate;

  test("is one the editor could have saved", () => {
    assert.ok(intakeFormSchema.safeParse(form).success);
  });

  test("has no questions or introduction of its own: the dates and automatic questions are all it asks", () => {
    assert.equal(form.questions.length, 0);
    assert.equal(form.introduction, "");
  });

  test("asks the automatic name, time zone and dietary checklist, as Pre-Bootcamp does", () => {
    assert.deepEqual(withAutomaticQuestions("intermediate", form.questions), [
      PREFERRED_NAME_QUESTION,
      TIMEZONE_QUESTION,
      DIETARY_QUESTION,
    ]);
  });
});

describe("a form's introduction", () => {
  test("is optional, and long enough for a page of travel rules", () => {
    assert.equal(intakeFormSchema.parse({ questions: [] }).introduction, "");
    assert.ok(
      intakeFormSchema.safeParse({
        introduction: "x".repeat(10000),
        questions: [],
      }).success,
    );
    assert.ok(
      !intakeFormSchema.safeParse({
        introduction: "x".repeat(10001),
        questions: [],
      }).success,
    );
  });

  test("lets a question run to 2,000 characters and an option to 500", () => {
    const q = {
      id: "a",
      kind: "choice",
      title: "x".repeat(2000),
      options: ["y".repeat(500)],
    };
    assert.ok(intakeFormSchema.safeParse({ questions: [q] }).success);
    assert.ok(
      !intakeFormSchema.safeParse({
        questions: [{ ...q, title: "x".repeat(2001) }],
      }).success,
    );
    assert.ok(
      !intakeFormSchema.safeParse({
        questions: [{ ...q, options: ["y".repeat(501)] }],
      }).success,
    );
  });
});

describe("saving a form", () => {
  test("drops options and Other from a question that does not use them", () => {
    const parsed = intakeFormSchema.parse({
      questions: [
        { id: "a", kind: "short", title: "A", options: ["x"], other: true },
      ],
    });
    assert.deepEqual(parsed.questions[0]!.options, []);
    assert.equal(parsed.questions[0]!.other, false);
  });

  test("keeps Other off a dropdown", () => {
    const parsed = intakeFormSchema.parse({
      questions: [
        { id: "a", kind: "dropdown", title: "A", options: ["x"], other: true },
      ],
    });
    assert.equal(parsed.questions[0]!.other, false);
  });

  test("refuses a list question with no options, repeated options, or repeated ids", () => {
    const q = { kind: "choice", title: "A" };
    assert.ok(
      !intakeFormSchema.safeParse({
        questions: [{ ...q, id: "a", options: [] }],
      }).success,
    );
    assert.ok(
      !intakeFormSchema.safeParse({
        questions: [{ ...q, id: "a", options: ["x", "x"] }],
      }).success,
    );
    assert.ok(
      !intakeFormSchema.safeParse({
        questions: [
          { ...q, id: "a", options: ["x"] },
          { ...q, id: "a", options: ["y"] },
        ],
      }).success,
    );
  });

  test("takes a form with no questions yet", () => {
    assert.ok(intakeFormSchema.safeParse({ questions: [] }).success);
  });

  test("refuses a title or description: each form's heading is its stage's", () => {
    assert.ok(
      !intakeFormSchema.safeParse({ title: "T", questions: FORM.questions })
        .success,
    );
    assert.ok(
      !intakeFormSchema.safeParse({
        description: "D",
        questions: FORM.questions,
      }).success,
    );
  });
});

describe("an attendee's answers", () => {
  test("are trimmed, with blanks and unknown questions dropped", () => {
    const out = checkAnswers(FORM, {
      name: "  Sam ",
      notes: "   ",
      nope: "x",
      langs: ["Go", " "],
    });
    assert.deepEqual(out, {
      ok: true,
      answers: { name: "Sam", langs: ["Go"] },
    });
  });

  test("need every required question", () => {
    assert.deepEqual(checkAnswers(FORM, { name: " " }), {
      ok: false,
      error: { questionId: "name", problem: "required" },
    });
  });

  test("take one free-text answer where a question offers Other, and none where it does not", () => {
    assert.ok(
      checkAnswers(FORM, { name: "Sam", attend: "Maybe the second day" }).ok,
    );
    assert.deepEqual(checkAnswers(FORM, { name: "Sam", diet: "Sometimes" }), {
      ok: false,
      error: { questionId: "diet", problem: "not_an_option" },
    });
    assert.deepEqual(
      checkAnswers(FORM, { name: "Sam", langs: ["Go", "Zig"] }),
      {
        ok: false,
        error: { questionId: "langs", problem: "not_an_option" },
      },
    );
  });

  test("give a single-answer question one answer", () => {
    assert.deepEqual(
      checkAnswers(FORM, { name: "Sam", attend: ["Yes", "No"] }),
      {
        ok: false,
        error: { questionId: "attend", problem: "not_an_option" },
      },
    );
    assert.deepEqual(checkAnswers(FORM, { name: ["Sam", "Alex"] }), {
      ok: false,
      error: { questionId: "name", problem: "not_an_option" },
    });
  });

  test("store a checkboxes answer as a list, even of one", () => {
    assert.deepEqual(checkAnswers(FORM, { name: "Sam", langs: "Rust" }), {
      ok: true,
      answers: { name: "Sam", langs: ["Rust"] },
    });
  });

  test("come with no email: whose they are is the sign-in that saves them", () => {
    assert.ok(intakeSubmissionSchema.safeParse({ answers: {} }).success);
    assert.ok(
      !intakeSubmissionSchema.safeParse({
        email: "sam@example.test",
        answers: {},
      }).success,
    );
  });
});

describe("the Slack reminder", () => {
  test("greets them by first name, names their form, and links to it", () => {
    assert.equal(
      intakeReminderText(
        "Sam Rivera",
        "intermediate",
        "https://app.test/intake",
      ),
      "Hi Sam! You haven't filled in your *Intermediate Registration* yet. It only takes a few minutes: <https://app.test/intake|complete it here>.",
    );
  });

  test("keeps a name from reading as Slack markup", () => {
    assert.match(
      intakeReminderText(
        "<!channel> & co",
        "bootcamp",
        "https://app.test/intake",
      ),
      /^Hi &lt;!channel&gt;!/,
    );
    assert.match(
      intakeReminderText("  ", "bootcamp", "https://app.test/intake"),
      /^Hi! .*Bootcamp Registration/,
    );
  });
});

describe("the name question", () => {
  const NAMED: IntakeForm = {
    introduction: "",
    questions: [
      {
        id: INTAKE_NAME_QUESTION_ID,
        kind: "short",
        title: "Name?",
        description: "",
        required: true,
        options: [],
        other: false,
      },
    ],
  };

  test("is the Pre-Bootcamp form's preferred-name question, while it is a short or paragraph answer", () => {
    const q = PREFERRED_NAME_QUESTION;
    assert.equal(q.title, PREFERRED_NAME_TITLE);
    assert.ok(!q.required);
    assert.ok(isNameQuestion(q));
    assert.ok(!isNameQuestion({ ...q, kind: "dropdown" }));
    assert.ok(!isNameQuestion({ ...q, id: "q-1234abcd" }));
  });

  test("takes one first name, as people spell them", () => {
    for (const name of ["Sam", "Mary-Kate", "José", "O'Neil", "Sam.", " Sam "])
      assert.ok(isFirstName(name), name);
  });

  test("refuses a name with a space in it, or anything not a name", () => {
    for (const name of [
      "Sam Rivera",
      "Mary Kate",
      "Sam 3",
      "Sam_Rivera",
      "3",
      "",
      "  ",
    ])
      assert.ok(!isFirstName(name), name);
  });

  test("closes up stray spaces around the name, and stores the answer that way", () => {
    assert.equal(normalizeName("  Sam   Rivera "), "Sam Rivera");
    assert.deepEqual(
      checkAnswers(NAMED, { [INTAKE_NAME_QUESTION_ID]: "  Sam " }),
      {
        ok: true,
        answers: { [INTAKE_NAME_QUESTION_ID]: "Sam" },
      },
    );
  });

  test("is refused when it is more than a first name", () => {
    assert.deepEqual(
      checkAnswers(NAMED, { [INTAKE_NAME_QUESTION_ID]: "Sam Rivera" }),
      {
        ok: false,
        error: { questionId: INTAKE_NAME_QUESTION_ID, problem: "not_a_name" },
      },
    );
  });

  test("replaces the first name on record and keeps the rest", () => {
    assert.equal(preferredFullName("Samuel Rivera", "Sam"), "Sam Rivera");
    assert.equal(
      preferredFullName("Samuel Van Der Berg", "Sam"),
      "Sam Van Der Berg",
    );
    assert.equal(preferredFullName("Samuel", "Sam"), "Sam");
    assert.equal(
      preferredFullName(" Samuel   Rivera ", "Samuel"),
      "Samuel Rivera",
    );
  });

  test("starts from the first name of an answer or a name saved as a full one", () => {
    assert.equal(firstNameOf("Sam"), "Sam");
    assert.equal(firstNameOf("  Sam   Rivera "), "Sam");
    assert.equal(firstNameOf(""), "");
  });
});

describe("the automatic questions", () => {
  const attend = DEFAULT_INTAKE_FORM.questions.find((q) => q.id === "attend")!;
  const saved = [
    PREFERRED_NAME_QUESTION,
    attend,
    { ...TIMEZONE_QUESTION, title: "Where are you?" },
    { ...DIETARY_QUESTION, title: "Anything to eat?" },
  ];

  test("lead Pre-Bootcamp as it is asked: the name, the time zone, the dietary checklist, then its own questions", () => {
    const asked = withAutomaticQuestions(
      "bootcamp",
      DEFAULT_INTAKE_FORM.questions,
    );
    assert.deepEqual(asked.slice(0, 3), [
      PREFERRED_NAME_QUESTION,
      TIMEZONE_QUESTION,
      DIETARY_QUESTION,
    ]);
    assert.deepEqual(asked.slice(3), DEFAULT_INTAKE_FORM.questions);
  });

  test("are asked once, whatever a saved form still holds of them", () => {
    assert.deepEqual(withAutomaticQuestions("bootcamp", saved), [
      PREFERRED_NAME_QUESTION,
      TIMEZONE_QUESTION,
      DIETARY_QUESTION,
      attend,
    ]);
  });

  test("are left out of what the form builder keeps", () => {
    assert.deepEqual(withoutAutomaticQuestions("bootcamp", saved), [attend]);
  });

  test("lead Pre-Intermediate the same way", () => {
    assert.deepEqual(withAutomaticQuestions("intermediate", saved), [
      PREFERRED_NAME_QUESTION,
      TIMEZONE_QUESTION,
      DIETARY_QUESTION,
      attend,
    ]);
    assert.deepEqual(withoutAutomaticQuestions("intermediate", saved), [
      attend,
    ]);
  });

  test("ask for an IANA time zone, though the question stores no options, and nothing else", () => {
    const form = { introduction: "", questions: [TIMEZONE_QUESTION] };
    assert.ok(isTimezoneQuestion(TIMEZONE_QUESTION));
    assert.ok(intakeFormSchema.safeParse(form).success);
    assert.deepEqual(checkAnswers(form, { timezone: "America/Chicago" }), {
      ok: true,
      answers: { timezone: "America/Chicago" },
    });
    assert.deepEqual(checkAnswers(form, { timezone: "Mars/Olympus" }), {
      ok: false,
      error: { questionId: "timezone", problem: "not_an_option" },
    });
    assert.equal(TIMEZONE_QUESTION.id, INTAKE_TIMEZONE_QUESTION_ID);
  });
});

describe("the dietary checklist", () => {
  const form = { introduction: "", questions: [DIETARY_QUESTION] };
  const { restrictions, critical, other } = DIETARY_KEYS;

  test("is the allergies, then the dietary and religious items, with Other last, none required", () => {
    assert.ok(isDietaryQuestion(DIETARY_QUESTION));
    assert.ok(intakeFormSchema.safeParse(form).success);
    assert.equal(DIETARY_QUESTION.required, false);
    assert.equal(DIETARY_ITEMS.at(-1), DIETARY_OTHER);
    assert.deepEqual(DIETARY_QUESTION.options, [...DIETARY_ITEMS]);
    assert.equal(new Set(DIETARY_ITEMS).size, DIETARY_ITEMS.length);
  });

  test("is skipped whole, or answered with nothing checked", () => {
    assert.deepEqual(checkAnswers(form, {}), { ok: true, answers: {} });
    assert.deepEqual(checkAnswers(form, { [restrictions]: [] }), {
      ok: true,
      answers: {},
    });
  });

  test("keeps what is checked in the checklist's order, once each, and the critical marks among them", () => {
    assert.deepEqual(
      checkAnswers(form, {
        [restrictions]: ["Vegan", "Peanuts", "Vegan", "Dairy"],
        [critical]: ["Peanuts"],
      }),
      {
        ok: true,
        answers: {
          [restrictions]: ["Dairy", "Peanuts", "Vegan"],
          [critical]: ["Peanuts"],
        },
      },
    );
  });

  test("rejects an item the checklist does not have, and a critical mark on one not checked", () => {
    const notAnOption = {
      ok: false,
      error: { questionId: restrictions, problem: "not_an_option" },
    };
    assert.deepEqual(
      checkAnswers(form, { [restrictions]: ["Dairy", "Mustard"] }),
      notAnOption,
    );
    assert.deepEqual(
      checkAnswers(form, { [restrictions]: ["Dairy"], [critical]: ["Eggs"] }),
      notAnOption,
    );
  });

  test("needs words for Other where it is checked, and drops them where it is not", () => {
    assert.deepEqual(
      checkAnswers(form, { [restrictions]: [DIETARY_OTHER], [other]: "  " }),
      {
        ok: false,
        error: { questionId: restrictions, problem: "required" },
      },
    );
    assert.deepEqual(
      checkAnswers(form, {
        [restrictions]: [DIETARY_OTHER],
        [critical]: [DIETARY_OTHER],
        [other]: " Cilantro ",
      }),
      {
        ok: true,
        answers: {
          [restrictions]: [DIETARY_OTHER],
          [critical]: [DIETARY_OTHER],
          [other]: "Cilantro",
        },
      },
    );
    assert.deepEqual(
      checkAnswers(form, { [restrictions]: ["Dairy"], [other]: "Cilantro" }),
      { ok: true, answers: { [restrictions]: ["Dairy"] } },
    );
  });

  test("takes one write-in, not several", () => {
    assert.deepEqual(
      checkAnswers(form, {
        [restrictions]: [DIETARY_OTHER],
        [other]: ["Cilantro", "Mint"],
      }),
      {
        ok: false,
        error: { questionId: restrictions, problem: "not_an_option" },
      },
    );
  });
});

describe("what Pre-Intermediate carries over from Pre-Bootcamp", () => {
  const bootcampAnswers = {
    "preferred-name": "Pat Example",
    attend: "Yes - I'm there!",
    [DIETARY_KEYS.restrictions]: ["Peanuts", DIETARY_OTHER],
    [DIETARY_KEYS.critical]: ["Peanuts"],
    [DIETARY_KEYS.other]: "Cilantro",
    concerns: "Arriving late on day one",
  };
  const asked = {
    introduction: "",
    questions: withAutomaticQuestions("intermediate", []),
  };

  test("is the dietary checklist's three answers, for a form that asks it, and nothing else", () => {
    assert.deepEqual(carriedAnswers(asked, bootcampAnswers), {
      [DIETARY_KEYS.restrictions]: ["Peanuts", DIETARY_OTHER],
      [DIETARY_KEYS.critical]: ["Peanuts"],
      [DIETARY_KEYS.other]: "Cilantro",
    });
  });

  test("is nothing for a form that does not ask the checklist, and leaves out an answer never given", () => {
    assert.deepEqual(
      carriedAnswers(DEFAULT_INTAKE_FORMS.intermediate, bootcampAnswers),
      {},
    );
    assert.deepEqual(
      carriedAnswers(asked, { [DIETARY_KEYS.restrictions]: ["Dairy"] }),
      { [DIETARY_KEYS.restrictions]: ["Dairy"] },
    );
  });

  test("is only answers Pre-Bootcamp's automatic checklist stores", () => {
    assert.deepEqual(
      [...CARRIED_TO_INTERMEDIATE].sort(),
      Object.values(DIETARY_KEYS).sort(),
    );
  });
});

describe("listing both forms' responses together", () => {
  test("asks for one form, or all, and falls back to Pre-Bootcamp", () => {
    assert.equal(responsesFormOf("intermediate"), "intermediate");
    assert.equal(responsesFormOf("all"), "all");
    assert.equal(responsesFormOf(undefined), "bootcamp");
    assert.equal(responsesFormOf("everything"), "bootcamp");
  });

  test("has a column for every question either form asks, one for each a both ask", () => {
    const columns = questionsOfBoth(
      DEFAULT_INTAKE_FORMS.bootcamp.questions,
      DEFAULT_INTAKE_FORMS.intermediate.questions,
    );
    const ids = columns.map((q) => q.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.deepEqual(
      ids,
      DEFAULT_INTAKE_FORMS.bootcamp.questions.map((q) => q.id),
    );
    const attend = columns.find((q) => q.id === "attend")!;
    assert.match(attend.title, /^Sales Bootcamp/);
  });

  test("adds a question only Pre-Intermediate asks after Pre-Bootcamp's", () => {
    const hotel = {
      ...DEFAULT_INTAKE_FORMS.bootcamp.questions[0]!,
      id: "hotel-nights",
      title: "Hotel nights",
    };
    const columns = questionsOfBoth(DEFAULT_INTAKE_FORMS.bootcamp.questions, [
      ...DEFAULT_INTAKE_FORMS.intermediate.questions,
      hotel,
    ]);
    assert.equal(columns.at(-1)!.id, "hotel-nights");
  });
});
