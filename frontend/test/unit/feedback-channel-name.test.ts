/** The private Slack channel a Live Sessions person is discussed in: its name, and the message posted there. */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import type { ClassSummary } from "../../src/lib/reporting/bootcamp-values";
import { feedbackChannelName, feedbackChannelText } from "../../src/lib/reporting/feedback-channel-values";

test("the name is the first and last words of the attendee's name", () => {
  assert.equal(feedbackChannelName("Jane Doe", "jane.doe@harness.io"), "event-feedback-jane-doe");
  assert.equal(feedbackChannelName("Mary Ann  Smith-Jones", "m@harness.io"), "event-feedback-mary-smith-jones");
});

test("accents and anything Slack does not allow in a name are dropped", () => {
  assert.equal(feedbackChannelName("José O'Brien", "j@harness.io"), "event-feedback-jose-o-brien");
});

test("someone with no name is named from their email", () => {
  assert.equal(feedbackChannelName(null, "sam.lee@harness.io"), "event-feedback-sam-lee");
  assert.equal(feedbackChannelName("  ", "x@harness.io"), "event-feedback-x");
});

test("a one-word name is used whole", () => {
  assert.equal(feedbackChannelName("Cher", "c@harness.io"), "event-feedback-cher");
});

test("a repeated name is numbered, within Slack's 80 characters", () => {
  assert.equal(feedbackChannelName("Jane Doe", "j@harness.io", 2), "event-feedback-jane-doe-2");
  const long = feedbackChannelName(`A ${"b".repeat(100)}`, "a@harness.io", 12);
  assert.ok(long.length <= 80);
  assert.ok(long.endsWith("-12"));
});

describe("feedbackChannelText", () => {
  const url = "https://harnessevents.io/reporting/bootcamp/e1";
  const summary: ClassSummary = {
    date: "2026-11-17",
    score: 2.66,
    exercises: [
      { name: "Discovery", score: 4, feedback: "Asked great questions." },
      { name: "Demo", score: 3.2, feedback: null },
      { name: "Objections <hard>", score: 1.5, feedback: "Missed the pricing pushback." },
      { name: "Exams", score: 1, feedback: null },
    ],
    positiveFeedback: "Strong presence.",
    constructiveFeedback: "Slow down & listen.",
    otherNotes: "Not sent",
    examAverage: 87.5,
  };

  test("is the first line alone for someone who has not attended", () => {
    assert.equal(
      feedbackChannelText("Pat", "Jane Doe", url, null),
      `Pat opened this to discuss *Jane Doe*: <${url}|their Live Sessions card>`,
    );
  });

  test("lists the scorecard below, in bold headings, leaving out every exercise that scored a 3", () => {
    assert.equal(
      feedbackChannelText("Pat", "Jane Doe", url, { stage: "bootcamp", summary }),
      [
        `Pat opened this to discuss *Jane Doe*: <${url}|their Live Sessions card>`,
        "",
        "*Overall Score (Bootcamp):* 3 / 4",
        "*Overall Positive Feedback:* Strong presence.",
        "*Overall Constructive Feedback:* Slow down &amp; listen.",
        "*Average Exam Score:* 88%",
        "*Score Breakdown (scores of 3 are filtered out here):*",
        "• Discovery: 4 — Asked great questions.",
        "• Objections &lt;hard&gt;: 2 — Missed the pricing pushback.",
        "• Exams: 1",
      ].join("\n"),
    );
  });

  test("leaves out empty feedback, a missing exam average, and the breakdown when every exercise is a 3", () => {
    const text = feedbackChannelText("Pat", "Jane Doe", url, {
      stage: "intermediate",
      summary: {
        ...summary,
        score: null,
        positiveFeedback: " ",
        constructiveFeedback: "",
        examAverage: null,
        exercises: [{ name: "Demo", score: 3, feedback: null }],
      },
    });
    assert.equal(text.split("\n").slice(1).join("\n"), "\n*Overall Score (Intermediate):* —");
  });
});
