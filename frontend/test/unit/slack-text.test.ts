/**
 * Reading a Slack message back for the run log, which shows each direct
 * message as Slack would: a reminder's bold form name and its link must
 * come through as such, and a name with markup in it must not.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { intakeReminderText } from "@/lib/logistics/intake-values";
import { slackTextParts } from "@/lib/slack-text";

describe("a Slack message, read back", () => {
  test("splits a reminder into its text, its bold form name and its link", () => {
    assert.deepEqual(slackTextParts(intakeReminderText("Sam Rivera", "bootcamp", "https://app.test/intake")), [
      { kind: "text", text: "Hi Sam! You haven't filled in your " },
      { kind: "bold", text: "Bootcamp Registration" },
      { kind: "text", text: " yet. It only takes a few minutes: " },
      { kind: "link", href: "https://app.test/intake", text: "complete it here" },
      { kind: "text", text: "." },
    ]);
  });

  test("shows an escaped name as typed, not as markup", () => {
    const parts = slackTextParts(intakeReminderText("<!channel>", "intermediate", "https://app.test/intake"));
    assert.deepEqual(parts[0], { kind: "text", text: "Hi <!channel>! You haven't filled in your " });
  });

  test("takes a bare link, and leaves a lone star alone", () => {
    assert.deepEqual(slackTextParts("See <https://x.test> * now"), [
      { kind: "text", text: "See " },
      { kind: "link", href: "https://x.test", text: "https://x.test" },
      { kind: "text", text: " * now" },
    ]);
  });

  test("never makes a link of anything but http or https", () => {
    assert.deepEqual(slackTextParts("<javascript:alert(1)|click>"), [{ kind: "text", text: "<javascript:alert(1)|click>" }]);
  });
});
