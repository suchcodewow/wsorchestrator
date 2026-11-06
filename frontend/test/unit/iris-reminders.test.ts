/** What a Diagnostic reminder says: where the person stands, and a link to their tests. */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { reminderText } from "@/lib/iris/reminder-values";

describe("a Diagnostic reminder", () => {
  test("greets them by first name, counts what is left, and lists each subject by where it stands", () => {
    const text = reminderText("Ava Rivera", { done: ["sdlc"], started: ["personas"], notStarted: ["companies", "pipegen"] }, "https://x.test/diagnostic/tests");
    assert.equal(
      text,
      [
        "Hi Ava, a reminder: you have 3 of 4 Diagnostic placement tests left to take.",
        "",
        "*Done:* SDLC",
        "*Started, not finished:* Personas",
        "*Not started:* Companies that serve the SDLC, Pipeline Generation",
        "",
        "<https://x.test/diagnostic/tests|Click to take diagnostic tests>",
      ].join("\n"),
    );
  });

  test("leaves out an empty group, and needs no name", () => {
    const text = reminderText("", { done: [], started: [], notStarted: ["sdlc"] }, "https://x.test/t");
    assert.match(text, /^A reminder: you have 1 of 1 Diagnostic placement test left/);
    assert.doesNotMatch(text, /Done:|Started/);
  });
});
