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
  DIETARY_QUESTION_IDS,
  CARRIED_TO_INTERMEDIATE,
  carriedAnswers,
  questionsOfBoth,
  responsesFormOf,
  INTAKE_NAME_QUESTION_ID,
  LOCKED_NAME_QUESTION,
  checkAnswers,
  isLockedQuestion,
  lockNameQuestion,
  intakeReminderText,
  isFirstLast,
  isNameQuestion,
  normalizeName,
  intakeFormSchema,
  intakeSubmissionSchema,
  type IntakeForm,
} from "@/lib/logistics/intake-values";

const FORM: IntakeForm = {
  introduction: "",
  questions: [
    { id: "name", kind: "short", title: "Name", description: "", required: true, options: [], other: false },
    { id: "notes", kind: "paragraph", title: "Notes", description: "", required: false, options: [], other: false },
    { id: "attend", kind: "choice", title: "Attend?", description: "", required: false, options: ["Yes", "No"], other: true },
    { id: "diet", kind: "dropdown", title: "Diet?", description: "", required: false, options: ["Yes", "No"], other: false },
    { id: "langs", kind: "checkboxes", title: "Languages", description: "", required: false, options: ["Go", "Rust"], other: false },
  ],
};

describe("the default form", () => {
  test("is one the editor could have saved", () => {
    assert.ok(intakeFormSchema.safeParse(DEFAULT_INTAKE_FORM).success);
  });

  test("asks the Google Form's seven questions, three of them required", () => {
    assert.equal(DEFAULT_INTAKE_FORM.questions.length, 7);
    assert.deepEqual(
      DEFAULT_INTAKE_FORM.questions.filter((q) => q.required).map((q) => q.id),
      ["preferred-name", "dietary", "dietary-critical"],
    );
  });

  test("is Pre-Bootcamp's, with the Google Form's introduction", () => {
    assert.equal(DEFAULT_INTAKE_FORMS.bootcamp, DEFAULT_INTAKE_FORM);
    assert.ok(intakeFormSchema.safeParse(DEFAULT_INTAKE_FORM).success);
    assert.match(DEFAULT_INTAKE_FORM.introduction, /^Sales Bootcamp takes place from Tuesday November 17/);
    assert.match(DEFAULT_INTAKE_FORM.introduction, /"All or Nothing"/);
  });
});

describe("the default Pre-Intermediate form", () => {
  const form = DEFAULT_INTAKE_FORMS.intermediate;

  test("is one the editor could have saved, introduction and all", () => {
    assert.ok(intakeFormSchema.safeParse(form).success);
    assert.match(form.introduction, /^Intermediate Training takes place/);
    assert.match(form.introduction, /"All or Nothing"/);
  });

  test("asks the Google Form's five questions, only the dietary one required", () => {
    assert.deepEqual(
      form.questions.map((q) => q.id),
      ["attend", "dietary", "dietary-needs", "dietary-critical", "concerns"],
    );
    assert.deepEqual(form.questions.filter((q) => q.required).map((q) => q.id), ["dietary"]);
  });

  test("asks the dietary questions under the ids the Logistics page reads, as Pre-Bootcamp does", () => {
    // Both groups are catered for together, so their answers must line up.
    const ids = new Set(form.questions.map((q) => q.id));
    for (const id of [DIETARY_QUESTION_IDS.has, DIETARY_QUESTION_IDS.needs, DIETARY_QUESTION_IDS.critical]) {
      assert.ok(ids.has(id), id);
      assert.ok(DEFAULT_INTAKE_FORM.questions.some((q) => q.id === id), id);
    }
  });

  test("asks no name question, so it saves no one's name", () => {
    assert.ok(!form.questions.some((q) => q.id === DIETARY_QUESTION_IDS.name));
  });
});

describe("a form's introduction", () => {
  test("is optional, and long enough for a page of travel rules", () => {
    assert.equal(intakeFormSchema.parse({ questions: [] }).introduction, "");
    assert.ok(intakeFormSchema.safeParse({ introduction: "x".repeat(10000), questions: [] }).success);
    assert.ok(!intakeFormSchema.safeParse({ introduction: "x".repeat(10001), questions: [] }).success);
  });

  test("lets a question run to 2,000 characters and an option to 500", () => {
    const q = { id: "a", kind: "choice", title: "x".repeat(2000), options: ["y".repeat(500)] };
    assert.ok(intakeFormSchema.safeParse({ questions: [q] }).success);
    assert.ok(!intakeFormSchema.safeParse({ questions: [{ ...q, title: "x".repeat(2001) }] }).success);
    assert.ok(!intakeFormSchema.safeParse({ questions: [{ ...q, options: ["y".repeat(501)] }] }).success);
  });
});

describe("saving a form", () => {
  test("drops options and Other from a question that does not use them", () => {
    const parsed = intakeFormSchema.parse({
      questions: [{ id: "a", kind: "short", title: "A", options: ["x"], other: true }],
    });
    assert.deepEqual(parsed.questions[0]!.options, []);
    assert.equal(parsed.questions[0]!.other, false);
  });

  test("keeps Other off a dropdown", () => {
    const parsed = intakeFormSchema.parse({
      questions: [{ id: "a", kind: "dropdown", title: "A", options: ["x"], other: true }],
    });
    assert.equal(parsed.questions[0]!.other, false);
  });

  test("refuses a list question with no options, repeated options, or repeated ids", () => {
    const q = { kind: "choice", title: "A" };
    assert.ok(!intakeFormSchema.safeParse({ questions: [{ ...q, id: "a", options: [] }] }).success);
    assert.ok(!intakeFormSchema.safeParse({ questions: [{ ...q, id: "a", options: ["x", "x"] }] }).success);
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
    assert.ok(!intakeFormSchema.safeParse({ title: "T", questions: FORM.questions }).success);
    assert.ok(!intakeFormSchema.safeParse({ description: "D", questions: FORM.questions }).success);
  });
});

describe("an attendee's answers", () => {
  test("are trimmed, with blanks and unknown questions dropped", () => {
    const out = checkAnswers(FORM, { name: "  Sam ", notes: "   ", nope: "x", langs: ["Go", " "] });
    assert.deepEqual(out, { ok: true, answers: { name: "Sam", langs: ["Go"] } });
  });

  test("need every required question", () => {
    assert.deepEqual(checkAnswers(FORM, { name: " " }), {
      ok: false,
      error: { questionId: "name", problem: "required" },
    });
  });

  test("take one free-text answer where a question offers Other, and none where it does not", () => {
    assert.ok(checkAnswers(FORM, { name: "Sam", attend: "Maybe the second day" }).ok);
    assert.deepEqual(checkAnswers(FORM, { name: "Sam", diet: "Sometimes" }), {
      ok: false,
      error: { questionId: "diet", problem: "not_an_option" },
    });
    assert.deepEqual(checkAnswers(FORM, { name: "Sam", langs: ["Go", "Zig"] }), {
      ok: false,
      error: { questionId: "langs", problem: "not_an_option" },
    });
  });

  test("give a single-answer question one answer", () => {
    assert.deepEqual(checkAnswers(FORM, { name: "Sam", attend: ["Yes", "No"] }), {
      ok: false,
      error: { questionId: "attend", problem: "not_an_option" },
    });
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
    assert.ok(!intakeSubmissionSchema.safeParse({ email: "sam@example.test", answers: {} }).success);
  });
});

describe("the Slack reminder", () => {
  test("greets them by first name, names their form, and links to it", () => {
    assert.equal(
      intakeReminderText("Sam Rivera", "intermediate", "https://app.test/intake"),
      "Hi Sam! You haven't filled in your *Intermediate Registration* yet. It only takes a few minutes: <https://app.test/intake|complete it here>.",
    );
  });

  test("keeps a name from reading as Slack markup", () => {
    assert.match(intakeReminderText("<!channel> & co", "bootcamp", "https://app.test/intake"), /^Hi &lt;!channel&gt;!/);
    assert.match(intakeReminderText("  ", "bootcamp", "https://app.test/intake"), /^Hi! .*Bootcamp Registration/);
  });
});

describe("the name question", () => {
  const NAMED: IntakeForm = {
    introduction: "",
    questions: [
      { id: INTAKE_NAME_QUESTION_ID, kind: "short", title: "Name?", description: "", required: true, options: [], other: false },
    ],
  };

  test("is the Pre-Bootcamp form's preferred-name question, while it is a short or paragraph answer", () => {
    const q = DEFAULT_INTAKE_FORM.questions.find((x) => x.id === INTAKE_NAME_QUESTION_ID)!;
    assert.ok(isNameQuestion(q));
    assert.ok(!isNameQuestion({ ...q, kind: "dropdown" }));
    assert.ok(!isNameQuestion({ ...q, id: "q-1234abcd" }));
  });

  test("takes a first and a last name, as people spell them", () => {
    for (const name of ["Sam Rivera", "Mary-Kate O'Neil", "José Núñez", "Sam R."]) assert.ok(isFirstLast(name), name);
  });

  test("refuses one name, three, or anything not a name", () => {
    for (const name of ["Sam", "Sam Lee Rivera", "Sam 3", "Sam_Rivera", "", "  "]) assert.ok(!isFirstLast(name), name);
  });

  test("closes up stray spaces, and stores the answer that way", () => {
    assert.equal(normalizeName("  Sam   Rivera "), "Sam Rivera");
    assert.deepEqual(checkAnswers(NAMED, { [INTAKE_NAME_QUESTION_ID]: "  Sam   Rivera " }), {
      ok: true,
      answers: { [INTAKE_NAME_QUESTION_ID]: "Sam Rivera" },
    });
  });

  test("is refused when it is not a first and a last name", () => {
    assert.deepEqual(checkAnswers(NAMED, { [INTAKE_NAME_QUESTION_ID]: "Sammy" }), {
      ok: false,
      error: { questionId: INTAKE_NAME_QUESTION_ID, problem: "not_a_name" },
    });
  });
});

describe("the locked name question", () => {
  const other = DEFAULT_INTAKE_FORM.questions.find((q) => q.id === "attend")!;

  test("comes first on the default Pre-Bootcamp form", () => {
    assert.equal(DEFAULT_INTAKE_FORM.questions[0]!.id, INTAKE_NAME_QUESTION_ID);
    assert.deepEqual(lockNameQuestion(DEFAULT_INTAKE_FORM.questions), DEFAULT_INTAKE_FORM.questions);
  });

  test("is locked on Pre-Bootcamp only", () => {
    assert.ok(isLockedQuestion("bootcamp", LOCKED_NAME_QUESTION));
    assert.ok(!isLockedQuestion("intermediate", LOCKED_NAME_QUESTION));
    assert.ok(!isLockedQuestion("bootcamp", other));
  });

  test("keeps a new title, and undoes every other change to it", () => {
    const altered = {
      ...LOCKED_NAME_QUESTION,
      title: "What should we call you?",
      kind: "dropdown" as const,
      description: "Anything",
      required: false,
      options: ["A"],
      other: true,
    };
    assert.deepEqual(lockNameQuestion([other, altered]), [
      { ...LOCKED_NAME_QUESTION, title: "What should we call you?" },
      other,
    ]);
  });

  test("moves back to first, and comes back when removed or left blank", () => {
    assert.equal(lockNameQuestion([other, LOCKED_NAME_QUESTION])[0]!.id, INTAKE_NAME_QUESTION_ID);
    assert.deepEqual(lockNameQuestion([other]), [LOCKED_NAME_QUESTION, other]);
    assert.deepEqual(lockNameQuestion([{ ...LOCKED_NAME_QUESTION, title: "  " }])[0], LOCKED_NAME_QUESTION);
  });
});

describe("what Pre-Intermediate carries over from Pre-Bootcamp", () => {
  const bootcampAnswers = {
    "preferred-name": "Pat Example",
    attend: "Yes - I'm there!",
    dietary: "Yes",
    "dietary-needs": "Peanut allergy",
    "dietary-critical": "5",
    concerns: "Arriving late on day one",
  };

  test("is the dietary answers only: what lasts from one cohort to the next", () => {
    assert.deepEqual(carriedAnswers(DEFAULT_INTAKE_FORMS.intermediate, bootcampAnswers), {
      dietary: "Yes",
      "dietary-needs": "Peanut allergy",
      "dietary-critical": "5",
    });
  });

  test("leaves out a carried question the intermediate form no longer asks, and an answer never given", () => {
    const fewer = {
      ...DEFAULT_INTAKE_FORMS.intermediate,
      questions: DEFAULT_INTAKE_FORMS.intermediate.questions.filter((q) => q.id !== "dietary-critical"),
    };
    assert.deepEqual(carriedAnswers(fewer, { dietary: "No" }), { dietary: "No" });
  });

  test("is only questions Pre-Bootcamp asks too", () => {
    for (const id of CARRIED_TO_INTERMEDIATE) {
      assert.ok(DEFAULT_INTAKE_FORM.questions.some((q) => q.id === id), id);
    }
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
    const columns = questionsOfBoth(DEFAULT_INTAKE_FORMS.bootcamp.questions, DEFAULT_INTAKE_FORMS.intermediate.questions);
    const ids = columns.map((q) => q.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.deepEqual(ids, DEFAULT_INTAKE_FORMS.bootcamp.questions.map((q) => q.id));
    // Every intermediate question is one Pre-Bootcamp asks too, under Pre-Bootcamp's wording.
    const attend = columns.find((q) => q.id === "attend")!;
    assert.match(attend.title, /^Sales Bootcamp/);
  });

  test("adds a question only Pre-Intermediate asks after Pre-Bootcamp's", () => {
    const hotel = { ...DEFAULT_INTAKE_FORMS.intermediate.questions[0]!, id: "hotel-nights", title: "Hotel nights" };
    const columns = questionsOfBoth(DEFAULT_INTAKE_FORMS.bootcamp.questions, [
      ...DEFAULT_INTAKE_FORMS.intermediate.questions,
      hotel,
    ]);
    assert.equal(columns.at(-1)!.id, "hotel-nights");
  });
});
