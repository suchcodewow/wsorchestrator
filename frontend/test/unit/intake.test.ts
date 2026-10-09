/**
 * The logistics intake form: what an administrator may save, and which
 * attendee answers are kept. The server checks answers against the form as
 * it stands when they arrive, so these are the only rules between a public
 * POST and the table.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_INTAKE_FORM,
  checkAnswers,
  intakeFormSchema,
  intakeSubmissionSchema,
  type IntakeForm,
} from "@/lib/logistics/intake-values";

const FORM: IntakeForm = {
  title: "Intake",
  description: "",
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
});

describe("saving a form", () => {
  test("drops options and Other from a question that does not use them", () => {
    const parsed = intakeFormSchema.parse({
      title: "T",
      questions: [{ id: "a", kind: "short", title: "A", options: ["x"], other: true }],
    });
    assert.deepEqual(parsed.questions[0]!.options, []);
    assert.equal(parsed.questions[0]!.other, false);
  });

  test("keeps Other off a dropdown", () => {
    const parsed = intakeFormSchema.parse({
      title: "T",
      questions: [{ id: "a", kind: "dropdown", title: "A", options: ["x"], other: true }],
    });
    assert.equal(parsed.questions[0]!.other, false);
  });

  test("refuses a list question with no options, repeated options, or repeated ids", () => {
    const q = { kind: "choice", title: "A" };
    assert.ok(!intakeFormSchema.safeParse({ title: "T", questions: [{ ...q, id: "a", options: [] }] }).success);
    assert.ok(!intakeFormSchema.safeParse({ title: "T", questions: [{ ...q, id: "a", options: ["x", "x"] }] }).success);
    assert.ok(
      !intakeFormSchema.safeParse({
        title: "T",
        questions: [
          { ...q, id: "a", options: ["x"] },
          { ...q, id: "a", options: ["y"] },
        ],
      }).success,
    );
  });

  test("refuses a form with no title or no questions", () => {
    assert.ok(!intakeFormSchema.safeParse({ title: " ", questions: FORM.questions }).success);
    assert.ok(!intakeFormSchema.safeParse({ title: "T", questions: [] }).success);
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

  test("come with an email, which is lowercased", () => {
    assert.equal(intakeSubmissionSchema.parse({ email: " Sam@Example.TEST ", answers: {} }).email, "sam@example.test");
    assert.ok(!intakeSubmissionSchema.safeParse({ email: "not an email", answers: {} }).success);
  });
});
