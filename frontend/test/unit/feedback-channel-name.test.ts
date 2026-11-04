/** The private Slack channel a Live Sessions person is discussed in: its name. */

import { test } from "node:test";
import assert from "node:assert/strict";

import { feedbackChannelName } from "../../src/lib/reporting/feedback-channel-values";

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
