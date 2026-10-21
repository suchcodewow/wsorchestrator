/**
 * Lining a Google Form's responses sheet up with an intake form. The sheet is
 * whatever Google wrote, so these pin the shapes it comes in: its own header
 * names, a question whose description Google kept in its title, checkboxes
 * joined with commas, and both kinds of timestamp a download can hold.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { normalizeHeader, planImport, readTimestamp } from "@/lib/logistics/intake-import-plan";
import type { IntakeQuestion } from "@/db/schema";

const question = (q: Partial<IntakeQuestion> & Pick<IntakeQuestion, "id" | "kind" | "title">): IntakeQuestion => ({
  description: "",
  required: false,
  options: [],
  other: false,
  ...q,
});

/** The questions the November 2026 Intermediate registration asked, which Pre-Intermediate no longer holds by default. */
const INTERMEDIATE: IntakeQuestion[] = [
  question({
    id: "attend",
    kind: "choice",
    title: "Intermediate takes place in-person on November 17 - 19, will you be there",
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
  question({ id: "dietary-needs", kind: "paragraph", title: "If yes, please describe your dietary needs." }),
  question({
    id: "dietary-critical",
    kind: "paragraph",
    title: "On a scale of 1 to 5, how critical are your dietary/allergy needs?",
  }),
  question({
    id: "concerns",
    kind: "short",
    title: "Any other concerns or special considerations we should be aware of? Write them in here.",
    description:
      "If you have received a copy of the Harness Value Framework V2.0 please bring it to training. If not, we will provide you with one.\n\nYou will need to pass an Intermediate entrance exam, so make sure to complete your pre-work in advance to prepare!",
  }),
];

/** The headers of the November 2026 Intermediate registration's responses sheet, as Google writes them. */
const HEADERS = [
  "Timestamp",
  "Email Address",
  "Intermediate takes place in-person on November 17 - 19, will you be there",
  "Are there any dietary restrictions that we should try to accommodate? (check yes for vegetarian, vegan, allergies, etc. and describe in the following field) ",
  "If yes, please describe your dietary needs.",
  "On a scale of 1 to 5, how critical are your dietary/allergy needs?",
  "If you have received a copy of the Harness Value Framework V2.0 please bring it to training. If not, we will provide you with one. \n\nYou will need to pass an Intermediate entrance exam, so make sure to complete your pre-work in advance to prepare! \n\nAny other concerns or special considerations we should be aware of? Write them in here. ",
];

describe("lining a responses sheet up with a form", () => {
  test("matches every question of the intermediate form, the long one by the title it ends with", () => {
    const plan = planImport([HEADERS, ["10/5/2026 14:03:22", "pat@example.test", "Yes - I'm there!", "Yes", "Vegan", "4", ""]], INTERMEDIATE);
    assert.ok(!("error" in plan));
    assert.deepEqual(
      plan.columns.map((c) => c.questionId),
      [null, null, "attend", "dietary", "dietary-needs", "dietary-critical", "concerns"],
    );
    assert.deepEqual(plan.entries, [
      {
        row: 2,
        email: "pat@example.test",
        submittedAt: "2026-10-05T14:03:22.000Z",
        answers: { attend: "Yes - I'm there!", dietary: "Yes", "dietary-needs": "Vegan", "dietary-critical": "4" },
      },
    ]);
  });

  test("lowercases emails, skips blank rows, and reports a row with no email or not one", () => {
    const plan = planImport(
      [HEADERS, [null, " Pat@Example.TEST "], [null, null, null], ["", "", "Yes - I'm there!"], [null, "not an email"]],
      INTERMEDIATE,
    );
    assert.ok(!("error" in plan));
    assert.deepEqual(plan.entries.map((e) => e.email), ["pat@example.test"]);
    assert.deepEqual(plan.problems, [
      { row: 4, problem: "no_email" },
      { row: 5, problem: "not_an_email" },
    ]);
  });

  test("needs an email column and at least one row", () => {
    assert.deepEqual(planImport([["Timestamp", "Name"], ["x", "y"]], INTERMEDIATE), { error: "no_email_column" });
    assert.deepEqual(planImport([HEADERS], INTERMEDIATE), { error: "empty" });
  });

  test("leaves a column that answers no question out", () => {
    const plan = planImport([["Email", "Shirt size"], ["pat@example.test", "M"]], INTERMEDIATE);
    assert.ok(!("error" in plan));
    assert.deepEqual(plan.columns, [
      { header: "Email", questionId: null },
      { header: "Shirt size", questionId: null },
    ]);
    assert.deepEqual(plan.entries[0]!.answers, {});
  });

  test("splits checkboxes on Google's commas, keeping an option that has a comma in it whole", () => {
    const nights: IntakeQuestion = {
      id: "nights",
      kind: "checkboxes",
      title: "Which nights do you need a hotel?",
      description: "",
      required: false,
      options: ["Sunday, Nov 15", "Monday", "Tuesday"],
      other: false,
    };
    const plan = planImport([["Email", "Which nights do you need a hotel?"], ["pat@example.test", "Sunday, Nov 15, Tuesday"]], [nights]);
    assert.ok(!("error" in plan));
    assert.deepEqual(plan.entries[0]!.answers, { nights: ["Sunday, Nov 15", "Tuesday"] });
  });
});

describe("a responses sheet's timestamps and headers", () => {
  test("read from a .csv's M/D/YYYY and an .xlsx's day count alike", () => {
    assert.equal(readTimestamp("10/5/2026 14:03:22"), "2026-10-05T14:03:22.000Z");
    assert.equal(readTimestamp("10/5/2026"), "2026-10-05T00:00:00.000Z");
    // 46300.5 days after 1899-12-30 is noon on 2026-10-05.
    assert.equal(readTimestamp(46300.5), "2026-10-05T12:00:00.000Z");
    assert.equal(readTimestamp("yesterday"), null);
    assert.equal(readTimestamp(null), null);
  });

  test("match whatever their case, spacing or closing question mark", () => {
    assert.equal(normalizeHeader("  On a scale of 1 to 5,  how critical?  "), "on a scale of 1 to 5, how critical");
  });
});
