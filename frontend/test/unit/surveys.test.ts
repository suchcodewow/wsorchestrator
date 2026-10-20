/**
 * The daily surveys' pure rules: which of a day's sessions a survey asks
 * about, who a track's "Assign Surveys" sends one to, when the scheduler
 * counts a day as sent, and which answers are kept.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  checkSurveyAnswers,
  formatAverage,
  surveyAudiencesOf,
  surveyDate,
  surveyGroupLabel,
  surveyMonth,
  surveySessions,
  trackDaySent,
  type SurveyDayStatus,
} from "@/lib/surveys/survey-values";

type Session = Parameters<typeof surveySessions>[0][number];

const session = (s: Partial<Session> & Pick<Session, "id">): Session => ({
  track: "btc",
  kind: "main",
  audience: "both",
  name: s.id,
  emoji: "",
  start: 540,
  minutes: 60,
  ...s,
});

describe("the sessions a survey asks about", () => {
  const day = [
    session({ id: "keynote", start: 540 }),
    session({ id: "se-lab", track: "btc_se", start: 600, audience: "engineers" }),
    session({ id: "pitch", start: 600, audience: "sales" }),
    session({ id: "lunch", kind: "unstructured", start: 720 }),
    session({ id: "int-only", track: "int", start: 540 }),
  ];

  test("sales get the class's sessions taught to them, in start order", () => {
    assert.deepEqual(
      surveySessions(day, "bootcamp", "sales").map((s) => s.id),
      ["keynote", "pitch"],
    );
  });

  test("engineers get the SE track's sessions too, the class first when two start together", () => {
    const both = [...day, session({ id: "both-at-ten", start: 600 })];
    assert.deepEqual(
      surveySessions(both, "bootcamp", "engineer").map((s) => s.id),
      ["keynote", "both-at-ten", "se-lab"],
    );
  });

  test("an unstructured session and another stage's are never asked about", () => {
    const ids = surveySessions(day, "intermediate", "engineer").map((s) => s.id);
    assert.deepEqual(ids, ["int-only"]);
  });

  test("keeps only what the survey shows", () => {
    assert.deepEqual(surveySessions([session({ id: "a", emoji: "🎤" })], "bootcamp", "sales"), [
      { id: "a", track: "btc", name: "a", emoji: "🎤", start: 540, minutes: 60 },
    ]);
  });
});

describe("who a track's surveys go to", () => {
  test("a class teaches sales and engineers; an SE track engineers alone", () => {
    assert.deepEqual(surveyAudiencesOf("btc"), ["sales", "engineer"]);
    assert.deepEqual(surveyAudiencesOf("int"), ["sales", "engineer"]);
    assert.deepEqual(surveyAudiencesOf("btc_se"), ["engineer"]);
    assert.deepEqual(surveyAudiencesOf("int_se"), ["engineer"]);
  });

  const days: SurveyDayStatus[] = [
    { stage: "bootcamp", day: 1, audiences: ["engineer"], assigned: 10, answered: 2 },
    { stage: "bootcamp", day: 2, audiences: ["sales", "engineer"], assigned: 30, answered: 0 },
  ];

  test("a day counts as sent once every audience its track teaches has a survey", () => {
    assert.equal(trackDaySent(days, "btc_se", 1), true);
    assert.equal(trackDaySent(days, "btc", 1), false);
    assert.equal(trackDaySent(days, "btc", 2), true);
    assert.equal(trackDaySent(days, "btc", 3), false);
    assert.equal(trackDaySent(days, "int", 2), false);
  });
});

describe("checking someone's answers", () => {
  const sessions = [{ id: "a" }, { id: "b" }];

  test("keeps one answer per session, trimmed", () => {
    const result = checkSurveyAnswers(sessions, {
      sessions: { a: { rating: 5, feedback: "  Great  " }, b: { rating: 2, feedback: "" } },
      dayRating: 4,
      dayChange: " More coffee \n",
    });
    assert.deepEqual(result, {
      ok: true,
      sessions: { a: { rating: 5, feedback: "Great" }, b: { rating: 2, feedback: "" } },
      dayRating: 4,
      dayChange: "More coffee",
    });
  });

  test("a session left unrated is named", () => {
    const result = checkSurveyAnswers(sessions, { sessions: { a: { rating: 3, feedback: "" } }, dayRating: 4, dayChange: "" });
    assert.deepEqual(result, { ok: false, error: { problem: "required", sessionId: "b" } });
  });

  test("an answer for a session the survey does not ask about is refused", () => {
    const result = checkSurveyAnswers(sessions, {
      sessions: { a: { rating: 3, feedback: "" }, b: { rating: 3, feedback: "" }, z: { rating: 1, feedback: "" } },
      dayRating: 4,
      dayChange: "",
    });
    assert.deepEqual(result, { ok: false, error: { problem: "unknown_session", sessionId: "z" } });
  });
});

describe("how results are labelled", () => {
  test("the group, month and day", () => {
    assert.equal(surveyGroupLabel("bootcamp", "sales"), "Bootcamp Sales");
    assert.equal(surveyGroupLabel("intermediate", "engineer"), "Intermediate Engineers");
    assert.equal(surveyMonth("2026-11-02"), "November 2026");
    assert.equal(surveyDate("2026-11-02"), "Monday, November 2");
  });

  test("an average to one decimal place, or a dash for none", () => {
    assert.equal(formatAverage(4.25), "4.3");
    assert.equal(formatAverage(4), "4.0");
    assert.equal(formatAverage(null), "—");
  });
});
