/**
 * Transcripts of the recordings judges make while scoring, against a real
 * database: each recording is transcribed once and filed with the attendee's
 * assessment at a bootcamp, and a bootcamp or assessment anything is filed
 * against cannot be deleted.
 *
 * Deepgram is never called: `fetch` is replaced with one that answers as its
 * pre-recorded endpoint does, and counts the calls.
 */

import "../support/test-env";

import { after, afterEach, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { like } from "drizzle-orm";

process.env.AUTH_SECRET ||= "evals-transcripts-test-secret-evals-trans";

import { db } from "@/db";
import { bootcamps, employees, evalsTranscripts } from "@/db/schema";
import { deleteAssessment } from "@/lib/evals/assessments";
import { getScoringForm, scoringTarget } from "@/lib/evals/scoring";
import { MAX_TRANSCRIPTS, listTranscripts, saveTranscript, type TranscriptFiling } from "@/lib/evals/transcripts";
import { deleteBootcamp } from "@/lib/scheduler/bootcamps";
import { PERSONAS } from "../support/access";
import { TEST_EMAIL_DOMAIN, TEST_PREFIX } from "../support/db";
import { testScope, type TestUser } from "../support/seed";

const scope = testScope("transcripts");
const today = new Date().toISOString().slice(0, 10);

let admin: TestUser;
let judge: TestUser;
let bootcampId: string;
let assessmentId: string;
let sales: { id: string; email: string };
let other: { id: string; email: string };

const realFetch = globalThis.fetch;
const realKey = process.env.DEEPGRAM_API_KEY;
let deepgramCalls = 0;

/** Answers the next Deepgram requests with `transcript`, or with an error status. */
function deepgram(answer: { transcript: string } | { status: number }) {
  process.env.DEEPGRAM_API_KEY = "test-key";
  globalThis.fetch = (async (url: string | URL | Request) => {
    assert.match(String(url), /^https:\/\/api\.deepgram\.com\/v1\/listen\?.*mip_opt_out=true/);
    deepgramCalls += 1;
    if ("status" in answer) return new Response("refused", { status: answer.status });
    return Response.json({
      results: {
        channels: [{ alternatives: [{ transcript: answer.transcript.replace(/\n+/g, " "), paragraphs: { transcript: `\n${answer.transcript}` } }] }],
      },
    });
  }) as typeof fetch;
}

async function candidate(key: string) {
  const id = `${TEST_PREFIX}${key}`;
  const email = `${TEST_PREFIX}${key}@${TEST_EMAIL_DOMAIN}`;
  await db.insert(employees).values({
    id,
    email,
    fullName: `Attendee ${key}`,
    title: "Solutions Engineer",
    track: "sales",
    orgDepth: 2,
    startDate: today,
    activeEffectiveDate: today,
    raw: {},
  });
  return { id, email };
}

const audio = () => new Blob([new Uint8Array([1, 2, 3, 4])], { type: "audio/webm;codecs=opus" });

const recording = (over: Partial<{ recordingId: string; recordedAt: Date; durationMs: number }> = {}) => ({
  recordingId: randomUUID(),
  recordedAt: new Date("2026-11-02T15:00:00Z"),
  durationMs: 192_000,
  audio: audio(),
  ...over,
});

const filing = (who = sales): TranscriptFiling => ({ bootcampId, assessmentId, attendeeEmail: who.email });

before(async () => {
  await scope.setUp();
  await db.delete(employees).where(like(employees.id, `${TEST_PREFIX}t_%`));
  admin = await scope.createUser("admin", PERSONAS.evalsAdmin);
  judge = await scope.createUser("judge", PERSONAS.guestJudge);
  bootcampId = await scope.activeBootcamp(admin.id);
  assessmentId = await scope.createAssessment(admin.id, `${TEST_PREFIX}Discovery call`);
  sales = await candidate("t_sales");
  other = await candidate("t_other");
});

afterEach(() => {
  globalThis.fetch = realFetch;
  process.env.DEEPGRAM_API_KEY = realKey;
  deepgramCalls = 0;
});

after(async () => {
  await db.delete(employees).where(like(employees.id, `${TEST_PREFIX}t_%`));
  await scope.tearDown();
});

describe("filing a transcript", () => {
  test("keeps Deepgram's paragraphs, the recorder's name, and shows on the scoring form", async () => {
    deepgram({ transcript: "Thanks for joining.\n\nWhat happens when a deploy fails?" });
    const r = recording();
    const saved = await saveTranscript(judge.id, filing(), r);
    assert.ok(saved.ok);
    assert.equal(saved.created, true);
    assert.equal(saved.transcript.text, "Thanks for joining.\n\nWhat happens when a deploy fails?");
    assert.equal(saved.transcript.recordedByName, "judge");
    assert.equal(saved.transcript.durationMs, 192_000);
    assert.equal(saved.transcript.recordedAt.getTime(), r.recordedAt.getTime());

    const form = await getScoringForm(assessmentId, sales.id, bootcampId);
    assert.deepEqual(form?.transcripts.map((t) => t.recordingId), [r.recordingId]);
    assert.deepEqual(await getScoringForm(assessmentId, sales.id, null).then((f) => f?.transcripts), []);
  });

  test("the same recording sent again is not transcribed again", async () => {
    deepgram({ transcript: "Once." });
    const r = recording();
    const first = await saveTranscript(judge.id, filing(), r);
    const again = await saveTranscript(judge.id, filing(), { ...r, audio: audio() });
    assert.ok(first.ok && again.ok);
    assert.equal(again.created, false);
    assert.equal(again.transcript.id, first.transcript.id);
    assert.equal(deepgramCalls, 1);
  });

  test("a recording already filed for one attendee cannot be filed for another", async () => {
    deepgram({ transcript: "Mine." });
    const r = recording();
    assert.ok((await saveTranscript(judge.id, filing(), r)).ok);
    assert.deepEqual(await saveTranscript(judge.id, filing(other), r), { ok: false, error: "conflict" });
  });

  test("nothing heard is still filed, as empty text", async () => {
    deepgram({ transcript: "" });
    const saved = await saveTranscript(judge.id, filing(), recording());
    assert.ok(saved.ok);
    assert.equal(saved.transcript.text, "");
  });

  test("without a key, or when Deepgram refuses, nothing is filed", async () => {
    process.env.DEEPGRAM_API_KEY = "";
    const r = recording();
    assert.deepEqual(await saveTranscript(judge.id, filing(), r), { ok: false, error: "unconfigured" });

    deepgram({ status: 500 });
    const refused = await saveTranscript(judge.id, filing(), r);
    assert.equal(refused.ok, false);
    assert.equal(!refused.ok && refused.error, "upstream");
    assert.match((!refused.ok && refused.detail) || "", /^500 refused/);

    const listed = await listTranscripts(filing());
    assert.ok(!listed.some((t) => t.recordingId === r.recordingId));
  });

  test("are listed oldest recording first, for that attendee only", async () => {
    deepgram({ transcript: "Later." });
    const later = recording({ recordedAt: new Date("2026-11-03T10:00:00Z") });
    const earlier = recording({ recordedAt: new Date("2026-11-03T09:00:00Z") });
    await saveTranscript(judge.id, filing(other), later);
    await saveTranscript(judge.id, filing(other), earlier);
    const listed = await listTranscripts(filing(other));
    const mine = listed.map((t) => t.recordingId).filter((id) => id === later.recordingId || id === earlier.recordingId);
    assert.deepEqual(mine, [earlier.recordingId, later.recordingId]);
    assert.ok(!(await listTranscripts(filing())).some((t) => t.recordingId === later.recordingId));
  });

  test(`at most ${MAX_TRANSCRIPTS} are kept for one attendee`, async () => {
    const full = await candidate("t_full");
    await db.insert(evalsTranscripts).values(
      Array.from({ length: MAX_TRANSCRIPTS }, (_, i) => ({
        ...filing(full),
        recordingId: randomUUID(),
        recordedById: judge.id,
        recordedAt: new Date(Date.UTC(2026, 10, 2, 0, i)),
        durationMs: 1000,
        text: `#${i}`,
      })),
    );
    deepgram({ transcript: "One too many." });
    assert.deepEqual(await saveTranscript(judge.id, filing(full), recording()), { ok: false, error: "too_many" });
    assert.equal(deepgramCalls, 0);
    assert.equal((await listTranscripts(filing(full))).length, MAX_TRANSCRIPTS);
  });

  test("the route's target is an attendee the assessment applies to", async () => {
    const target = await scoringTarget(assessmentId, sales.id);
    assert.ok(target.ok);
    assert.equal(target.attendee.email, sales.email);
    assert.deepEqual(await scoringTarget(assessmentId, `${TEST_PREFIX}nobody`), { ok: false, error: "not_found" });
    assert.deepEqual(await scoringTarget(randomUUID(), sales.id), { ok: false, error: "not_found" });
  });
});

describe("what a transcript is filed against", () => {
  test("an assessment with only a transcript is kept", async () => {
    const id = await scope.createAssessment(admin.id, `${TEST_PREFIX}Recorded only`);
    deepgram({ transcript: "Kept." });
    assert.ok((await saveTranscript(judge.id, { ...filing(), assessmentId: id }, recording())).ok);
    assert.deepEqual(await deleteAssessment(id), { ok: false, error: "has_scores" });
  });

  test("a bootcamp with only a transcript is kept", async () => {
    // A bootcamp of this suite's own, so a failure here could never delete the active one.
    const [made] = await db
      .insert(bootcamps)
      .values({ startDate: "2027-03-01", btcDays: 4, intDays: null, status: "scheduled", createdBy: admin.id })
      .returning({ id: bootcamps.id });
    await db.insert(evalsTranscripts).values({
      bootcampId: made!.id,
      assessmentId,
      attendeeEmail: sales.email,
      recordingId: randomUUID(),
      recordedById: judge.id,
      recordedAt: new Date(),
      durationMs: 1000,
      text: "",
    });
    assert.deepEqual(await deleteBootcamp(made!.id), { ok: false, error: "has_scores" });
  });
});
