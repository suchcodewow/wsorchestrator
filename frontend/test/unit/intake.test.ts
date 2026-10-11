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
  checkAnswers,
  intakeReminderText,
  intakeFormSchema,
  intakeSubmissionSchema,
  type IntakeForm,
} from "@/lib/logistics/intake-values";

const FORM: IntakeForm = {
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
      ["dietary", "dietary-critical", "preferred-name"],
    );
  });

  test("is Pre-Bootcamp's, and Pre-Intermediate starts with nothing to ask", () => {
    assert.equal(DEFAULT_INTAKE_FORMS.bootcamp, DEFAULT_INTAKE_FORM);
    assert.deepEqual(DEFAULT_INTAKE_FORMS.intermediate.questions, []);
    assert.ok(intakeFormSchema.safeParse(DEFAULT_INTAKE_FORMS.intermediate).success);
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
