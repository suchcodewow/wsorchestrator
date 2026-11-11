/**
 * The Diagnostic's Slack reminders, against a real database and no Slack.
 *
 * The rules, restated here independently of `lib/iris/reminders`:
 * 1. A Participant is due while any open subject (enough approved questions)
 *    is not finished; nobody is due while no subject is open.
 * 2. Until reminders are live every run is a dry run: it logs each message it
 *    would send, and sends nothing.
 * 3. A live run needs Slack, and says so rather than pretending to send.
 * 4. Each message says where the person stands and links to their tests.
 *
 * Reviews and the reminder settings are shared by the whole database, so the
 * suite saves them first and puts them back afterwards, and deletes the runs
 * it made.
 */

import "../support/test-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { eq, inArray, or } from "drizzle-orm";

import { db } from "@/db";
import { IRIS_SETTINGS_KEYS, irisItemReviews, irisReminderMessages, irisReminderRuns, irisSettings } from "@/db/schema";
import { answer, setTrack, startSitting } from "@/lib/iris/attempts";
import { IDK } from "@/lib/iris/engine";
import { approveDrafts } from "@/lib/iris/reviews";
import { dueParticipants, getReminderRun, listReminderMessages, runDiagnosticReminders, setRemindersLive } from "@/lib/iris/reminders";
import { IRIS_REMINDER_MESSAGE_LIST } from "@/lib/list-specs";
import { slackToken } from "@/lib/slack";
import { PERSONAS } from "../support/access";
import { testScope, type TestUser } from "../support/seed";

const scope = testScope("irisr");
const KEYS = [IRIS_SETTINGS_KEYS.remindersLive, IRIS_SETTINGS_KEYS.remindersSentOn];
const APP = "https://app.example.test";

let savedReviews: (typeof irisItemReviews.$inferSelect)[] = [];
let savedSettings: (typeof irisSettings.$inferSelect)[] = [];
const runs: string[] = [];
let admin: TestUser;
let taker: TestUser;

const deadline = () => Date.now() + 60_000;
const mine = <T extends { email: string }>(due: T[]) => due.filter((p) => p.email === taker.email);

before(async () => {
  delete process.env.SLACK_BOT_TOKEN;
  await scope.setUp();
  savedReviews = await db.select().from(irisItemReviews);
  savedSettings = await db.select().from(irisSettings).where(inArray(irisSettings.key, KEYS));
  await db.delete(irisItemReviews);
  await db.delete(irisSettings).where(inArray(irisSettings.key, KEYS));
  admin = await scope.createUser("admin", PERSONAS.assessmentsAdmin);
  taker = await scope.createUser("taker", PERSONAS.participant);
});

after(async () => {
  if (runs.length) await db.delete(irisReminderRuns).where(inArray(irisReminderRuns.id, runs));
  await db.delete(irisItemReviews);
  if (savedReviews.length) await db.insert(irisItemReviews).values(savedReviews);
  await db.delete(irisSettings).where(or(...KEYS.map((k) => eq(irisSettings.key, k))));
  if (savedSettings.length) await db.insert(irisSettings).values(savedSettings);
  await scope.tearDown();
});

describe("Diagnostic reminders", () => {
  test("the suite runs without Slack", async () => {
    assert.equal(await slackToken(), null, "a Slack token would make a dry run ask Slack who everyone is");
  });

  test("nobody is due while no subject is open, and a run says why it skipped", async () => {
    const { assigned, due } = await dueParticipants();
    assert.deepEqual(assigned, []);
    assert.deepEqual(due, []);
    const result = await runDiagnosticReminders("manual", admin.id, deadline(), { appUrl: APP });
    assert.ok(result.ok);
    runs.push(result.runId);
    assert.equal(result.status, "skipped");
    assert.match(result.note ?? "", /No subject is open/);
  });

  test("a Participant with an open subject left is due, with where they stand", async () => {
    await approveDrafts(admin.id, "sdlc", "A");
    const { assigned, due } = await dueParticipants();
    assert.deepEqual(assigned, ["sdlc"]);
    assert.deepEqual(mine(due), [{ email: taker.email, fullName: "taker", status: { done: [], started: [], notStarted: ["sdlc"] } }]);
  });

  test("not live, a run is a dry run that logs the message it would send", async () => {
    const result = await runDiagnosticReminders("manual", admin.id, deadline(), { appUrl: APP });
    assert.ok(result.ok, JSON.stringify(result));
    runs.push(result.runId);
    assert.equal(result.dryRun, true);
    assert.equal(result.status, "succeeded");
    assert.match(result.note ?? "", /Slack is not connected/);
    const page = await listReminderMessages(result.runId, { ...IRIS_REMINDER_MESSAGE_LIST, q: taker.email, page: 1 });
    assert.equal(page.rows.length, 1);
    assert.equal(page.rows[0]!.outcome, "messaged");
    assert.match(page.rows[0]!.detail, /1 of 1 Diagnostic placement test left/);
    assert.match(page.rows[0]!.detail, /\*Not started:\* SDLC/);
    assert.ok(page.rows[0]!.detail.includes(`<${APP}/diagnostic/tests|`));
    assert.equal((await getReminderRun(result.runId))?.triggeredByName, "admin");
  });

  test("live without Slack refuses to send, and logs the failure", async () => {
    await setRemindersLive(admin.id, true);
    try {
      const result = await runDiagnosticReminders("schedule", null, deadline(), { appUrl: APP });
      assert.equal(result.ok, false);
      if (result.ok) return;
      runs.push(result.runId!);
      assert.equal(result.error, "not_configured");
      assert.equal((await getReminderRun(result.runId!))?.status, "failed");
      // A dry run asked for by preview still works while live.
      const preview = await runDiagnosticReminders("manual", admin.id, deadline(), { appUrl: APP, preview: true });
      assert.ok(preview.ok && preview.dryRun);
      runs.push(preview.runId);
    } finally {
      await setRemindersLive(admin.id, false);
    }
  });

  test("a sitting in progress shows as started, and a finished one stops the reminders", async () => {
    await setTrack(taker.id, "AE");
    const start = await startSitting(taker.id, "sdlc", "A", "live");
    assert.ok(start.ok);
    assert.deepEqual(mine((await dueParticipants()).due)[0]?.status, { done: [], started: ["sdlc"], notStarted: [] });

    let sitting = start.sitting;
    for (let guard = 0; guard < 30; guard++) {
      const res = await answer(taker.id, sitting.attemptId, sitting.number, IDK);
      assert.ok(res.ok);
      if (res.done) break;
      sitting = res.sitting;
    }
    assert.deepEqual(mine((await dueParticipants()).due), [], "every open subject finished");
  });

  test("a run's messages go with it", async () => {
    const [first] = runs;
    await db.delete(irisReminderRuns).where(eq(irisReminderRuns.id, first!));
    assert.equal((await db.select().from(irisReminderMessages).where(eq(irisReminderMessages.runId, first!))).length, 0);
  });
});
