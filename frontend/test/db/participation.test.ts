/**
 * Participation against a real database: judges share a counter from 0 to 3,
 * the built-in assessment stays out of everything a judge is offered, and a
 * generated score counts in the class. No Claude key runs here, so generation
 * only ever writes people with no comment to write.
 *
 * Marks and submissions made here are on `TEST_PREFIX` attendees, removed by
 * email at the end; the active bootcamp is the one `scope` finds or makes.
 */

import "../support/test-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { and, eq, like } from "drizzle-orm";

process.env.AUTH_SECRET ||= "participation-test-secret-participation";
delete process.env.ANTHROPIC_API_KEY;

import { db } from "@/db";
import {
  employees,
  evalsAssessments,
  evalsSubmissions,
  participationDescriptors,
  participationMarkEvents,
  participationMarks,
} from "@/db/schema";
import { createAssessment, getAssessment, deleteAssessment, listAssessments } from "@/lib/evals/assessments";
import {
  activeDescriptors,
  adjustMark,
  generateParticipation,
  getParticipationSheet,
  pendingParticipation,
  regenerateParticipation,
  saveParticipationSettings,
  participationSettings,
} from "@/lib/evals/participation";
import { getScoringForm, saveSubmission, scoringAssessment } from "@/lib/evals/scoring";
import { ASSESSMENT_LIST } from "@/lib/list-specs";
import { PERSONAS } from "../support/access";
import { TEST_EMAIL_DOMAIN, TEST_PREFIX } from "../support/db";
import { testScope, type TestUser } from "../support/seed";

const scope = testScope("partic");
const SCOPED = `${TEST_PREFIX}partic_`;
const today = new Date().toISOString().slice(0, 10);

let admin: TestUser;
let judge: TestUser;
let bootcampId: string;
let built: { id: string };
let positive: { id: string };
let negative: { id: string };

async function attendee(key: string) {
  const id = `${SCOPED}${key}`;
  const email = `${SCOPED}${key}@${TEST_EMAIL_DOMAIN}`.toLowerCase();
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

const participationRow = async (email: string) => {
  const [row] = await db
    .select()
    .from(evalsSubmissions)
    .where(and(eq(evalsSubmissions.assessmentId, built.id), eq(evalsSubmissions.attendeeEmail, email)));
  return row ?? null;
};

before(async () => {
  await scope.setUp();
  await db.delete(employees).where(like(employees.id, `${SCOPED}%`));
  admin = await scope.createUser("admin", PERSONAS.assessmentsAdmin);
  judge = await scope.createUser("judge", PERSONAS.guestJudge);
  bootcampId = await scope.activeBootcamp(admin.id);
  const [row] = await db
    .select({ id: evalsAssessments.id })
    .from(evalsAssessments)
    .where(and(eq(evalsAssessments.builtIn, "participation"), eq(evalsAssessments.stage, "bootcamp")));
  built = row!;
  const descriptors = await activeDescriptors();
  positive = descriptors.find((d) => d.polarity === "positive")!;
  negative = descriptors.find((d) => d.polarity === "negative")!;
});

after(async () => {
  await db.delete(evalsSubmissions).where(like(evalsSubmissions.attendeeEmail, `${SCOPED}%`));
  await db.delete(participationMarks).where(like(participationMarks.attendeeEmail, `${SCOPED}%`));
  await db.delete(participationMarkEvents).where(like(participationMarkEvents.attendeeEmail, `${SCOPED}%`));
  await db.delete(employees).where(like(employees.id, `${SCOPED}%`));
  await scope.tearDown();
});

describe("marks", () => {
  test("judges share one counter that stops at 3 and at 0", async () => {
    const a = await attendee("counter");
    const up = { descriptorId: positive.id, delta: 1 as const };
    await adjustMark(admin.id, a.id, up, false);
    await adjustMark(judge.id, a.id, up, false);
    await adjustMark(judge.id, a.id, up, false);
    const fourth = await adjustMark(admin.id, a.id, up, false);
    assert.ok(fourth.ok);
    assert.equal(fourth.moved, false);
    const row = fourth.sheet.descriptors.find((d) => d.id === positive.id)!;
    assert.equal(row.count, 3);
    assert.equal(row.adjustments.length, 2);

    const down = { descriptorId: negative.id, delta: -1 as const };
    const below = await adjustMark(admin.id, a.id, down, false);
    assert.ok(below.ok);
    assert.equal(below.moved, false);
    assert.equal(below.sheet.descriptors.find((d) => d.id === negative.id)!.count, 0);
  });

  test("the running score appears with the first mark", async () => {
    const a = await attendee("running");
    const before = await getParticipationSheet(a.id, false);
    assert.ok(before.ok);
    assert.equal(before.sheet.runningScore, null);
    const marked = await adjustMark(judge.id, a.id, { descriptorId: positive.id, delta: 1 }, false);
    assert.ok(marked.ok);
    assert.equal(marked.sheet.runningScore, 2);
  });

  test("only an administrator's sheet carries what was saved", async () => {
    const a = await attendee("saved");
    const sheet = await getParticipationSheet(a.id, false);
    assert.ok(sheet.ok);
    assert.equal(sheet.sheet.saved, null);
  });
});

describe("the built-in assessment", () => {
  test("is offered to nobody", async () => {
    assert.equal(await scoringAssessment(built.id), null);
    assert.equal(await getAssessment(built.id), null);
    const page = await listAssessments({ ...ASSESSMENT_LIST, q: "Participation", page: 1 });
    assert.equal(page.rows.some((r) => r.id === built.id), false);
    const a = await attendee("hidden");
    assert.equal(await getScoringForm(built.id, a.id, bootcampId), null);
  });

  test("cannot be deleted", async () => {
    assert.deepEqual(await deleteAssessment(built.id), { ok: false, error: "not_found" });
  });
});

describe("generating", () => {
  test("scores someone assessed and unmarked a 2, and leaves everyone else blank until pressed", async () => {
    const assessed = await attendee("assessed");
    const absent = await attendee("absent");

    const saved = await createAssessment(admin.id, {
      name: `${TEST_PREFIX}Demo`,
      stage: "bootcamp",
      audience: "both",
      active: true,
      criteria: [{ name: "Demo", description: "" }],
    });
    assert.ok(saved.ok);
    const [criterion] = (await getAssessment(saved.id))!.criteria;
    const scored = await saveSubmission(admin.id, saved.id, assessed.id, {
      scores: [{ criterionId: criterion!.id, score: 3, comment: "" }],
      positiveFeedback: "",
      constructiveFeedback: "",
      revises: null,
    });
    assert.ok(scored.ok);
    assert.equal(await participationRow(assessed.email), null);

    const pending = await pendingParticipation();
    assert.ok(pending.bootcamp);
    assert.ok(pending.bootcamp.skipped.includes("Attendee absent"));

    // Someone with marks needs Claude, which is not set up here, so clear the way for this one attendee.
    await db.delete(participationMarks).where(like(participationMarks.attendeeEmail, `${SCOPED}%`));
    const ran = await generateParticipation(admin.id, "bootcamp");
    if (!ran.ok) assert.equal(ran.error, "unconfigured");
    else {
      assert.equal((await participationRow(assessed.email))?.averageScore, 2);
      assert.equal((await participationRow(assessed.email))?.positiveFeedback, "");
      assert.equal(await participationRow(absent.email), null);
    }
  });

  test("Regenerate needs a saved assessment", async () => {
    const a = await attendee("regen");
    assert.deepEqual(await regenerateParticipation(admin.id, a.id), { ok: false, error: "not_generated" });
  });
});

describe("settings", () => {
  test("a descriptor left off the list is retired, and the bands save", async () => {
    const before = await participationSettings();
    const extra = await saveParticipationSettings(admin.id, {
      descriptors: [...before.descriptors, { name: `${TEST_PREFIX}Extra`, polarity: "positive" }],
      bands: { four: 7, three: 2, two: -1 },
    });
    assert.ok(extra.ok);
    const added = extra.settings.descriptors.find((d) => d.name === `${TEST_PREFIX}Extra`)!;
    assert.equal(extra.settings.bands.four, 7);

    const back = await saveParticipationSettings(admin.id, before);
    assert.ok(back.ok);
    assert.equal(back.settings.descriptors.some((d) => d.id === added.id), false);
    const [retired] = await db.select().from(participationDescriptors).where(eq(participationDescriptors.id, added.id));
    assert.ok(retired?.retiredAt);
    await db.delete(participationDescriptors).where(eq(participationDescriptors.id, added.id));
  });

  test("two descriptors cannot share a name", async () => {
    const { bands } = await participationSettings();
    const same = { name: "Same", polarity: "positive" as const };
    assert.deepEqual(await saveParticipationSettings(admin.id, { descriptors: [same, same], bands }), {
      ok: false,
      error: "duplicate",
    });
  });
});
