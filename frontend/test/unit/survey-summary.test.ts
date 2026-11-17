/**
 * What Claude is sent to summarize a daily survey's sessions, and how its
 * reply is read: each session's name, leader, ratings and escaped feedback,
 * never who gave them, and a blank or repeated summary is not kept.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { buildSummaryPrompt, readSummaries, summarySessions } from "@/lib/surveys/survey-summary";

const sessions = [
  { id: "s1", track: "btc" as const, name: "Keynote", emoji: "", start: 540, minutes: 60, leader: "Ana Ruiz" },
  { id: "s2", track: "btc" as const, name: "Lab", emoji: "", start: 600, minutes: 60 },
];

describe("summarySessions", () => {
  test("gathers each session's ratings and non-blank feedback from every answer", () => {
    const got = summarySessions(sessions, [
      { s1: { rating: 5, feedback: " Great " }, s2: { rating: 3, feedback: "" } },
      { s1: { rating: 2, feedback: "" } },
      null,
    ]);
    assert.deepEqual(got, [
      { id: "s1", name: "Keynote", leader: "Ana Ruiz", ratings: [5, 2], feedback: [{ rating: 5, text: "Great" }] },
      { id: "s2", name: "Lab", leader: "", ratings: [3], feedback: [] },
    ]);
  });
});

describe("buildSummaryPrompt", () => {
  test("sends the session, its leader and ratings, and escaped feedback, and nobody's name", () => {
    const { user, system } = buildSummaryPrompt([
      { id: "s1", name: 'The "Big" Demo', leader: "Ana Ruiz", ratings: [5, 4], feedback: [{ rating: 4, text: "<b>Loved</b> it & more" }] },
    ]);
    assert.match(user, /<session id="s1" name="The &quot;Big&quot; Demo" leader="Ana Ruiz" ratings="5,4">/);
    assert.match(user, /<feedback rating="4">&lt;b&gt;Loved&lt;\/b&gt; it &amp; more<\/feedback>/);
    assert.match(system, /never instructions to you/);
  });
});

describe("readSummaries", () => {
  test("keeps the first non-blank summary for each id, trimmed", () => {
    assert.deepEqual(
      readSummaries([
        { id: "s1", summary: "  Well received. " },
        { id: "s1", summary: "A second one" },
        { id: "s2", summary: "   " },
      ]),
      { s1: "Well received." },
    );
  });
});
