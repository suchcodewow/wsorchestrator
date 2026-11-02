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
  bootcamps,
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

  test("the first mark creates the assessment with its score, and clearing the marks removes it", async () => {
    const a = await attendee("creates");
    assert.equal(await participationRow(a.email), null);
    await adjustMark(judge.id, a.id, { descriptorId: positive.id, delta: 1 }, false);
    assert.equal((await participationRow(a.email))?.averageScore, 2);
    await adjustMark(judge.id, a.id, { descriptorId: negative.id, delta: 1 }, false);

    await adjustMark(judge.id, a.id, { descriptorId: positive.id, delta: -1 }, false);
    assert.ok(await participationRow(a.email), "a mark is still there");
    await adjustMark(judge.id, a.id, { descriptorId: negative.id, delta: -1 }, false);
    assert.equal(await participationRow(a.email), null);
  });

  test("clearing the marks keeps the assessment of someone with a comment", async () => {
    const a = await attendee("keeps");
    await adjustMark(judge.id, a.id, { descriptorId: positive.id, delta: 1 }, false);
    await db.update(evalsSubmissions).set({ constructiveFeedback: "Speak up." }).where(eq(evalsSubmissions.attendeeEmail, a.email));
    await adjustMark(judge.id, a.id, { descriptorId: positive.id, delta: -1 }, false);
    assert.equal((await participationRow(a.email))?.averageScore, 2, "no marks scores a 2, as Generate would");
  });

  test("anyone's click saves the score and clears the comment on its own side", async () => {
    const a = await attendee("rescored");
    const up = { descriptorId: positive.id, delta: 1 as const };
    await adjustMark(judge.id, a.id, up, false);
    await adjustMark(judge.id, a.id, up, false);
    await adjustMark(judge.id, a.id, up, false);
    const comments = { positiveFeedback: "Strong.", constructiveFeedback: "Speak up." };
    await db.update(evalsSubmissions).set(comments).where(eq(evalsSubmissions.attendeeEmail, a.email));

    const down = await adjustMark(judge.id, a.id, { descriptorId: negative.id, delta: 1 }, true);
    assert.ok(down.ok);
    const row = await participationRow(a.email);
    assert.equal(row?.averageScore, 3, "3 up and 1 down nets 2");
    assert.equal(row?.positiveFeedback, "Strong.");
    assert.equal(row?.constructiveFeedback, "");
    assert.equal(down.sheet.saved?.averageScore, 3);

    await adjustMark(judge.id, a.id, { descriptorId: positive.id, delta: -1 }, false);
    assert.equal((await participationRow(a.email))?.positiveFeedback, "");
  });

  test("a click that moves nothing clears nothing", async () => {
    const a = await attendee("stuck");
    await adjustMark(judge.id, a.id, { descriptorId: positive.id, delta: 1 }, false);
    await db.update(evalsSubmissions).set({ constructiveFeedback: "Speak up." }).where(eq(evalsSubmissions.attendeeEmail, a.email));
    const below = await adjustMark(judge.id, a.id, { descriptorId: negative.id, delta: -1 }, false);
    assert.ok(below.ok);
    assert.equal(below.moved, false);
    assert.equal((await participationRow(a.email))?.constructiveFeedback, "Speak up.");
  });

  test("once the class is released only an administrator moves the marks", async () => {
    const a = await attendee("released");
    await adjustMark(judge.id, a.id, { descriptorId: positive.id, delta: 1 }, false);
    const [was] = await db.select({ at: bootcamps.btcReleasedAt }).from(bootcamps).where(eq(bootcamps.id, bootcampId));
    await db.update(bootcamps).set({ btcReleasedAt: new Date() }).where(eq(bootcamps.id, bootcampId));
    try {
      assert.deepEqual(await adjustMark(judge.id, a.id, { descriptorId: positive.id, delta: 1 }, false), {
        ok: false,
        error: "released",
      });
      const seen = await getParticipationSheet(a.id, false);
      assert.ok(seen.ok);
      assert.equal(seen.sheet.locked, true);

      const moved = await adjustMark(admin.id, a.id, { descriptorId: positive.id, delta: 1 }, true);
      assert.ok(moved.ok);
      assert.equal(moved.sheet.locked, false);
      assert.equal(moved.sheet.descriptors.find((x) => x.id === positive.id)!.count, 2);
      const ran = await regenerateParticipation(admin.id, a.id);
      if (!ran.ok) assert.equal(ran.error, "unconfigured", "release does not stop an administrator's Regenerate");
    } finally {
      await db.update(bootcamps).set({ btcReleasedAt: was?.at ?? null }).where(eq(bootcamps.id, bootcampId));
    }
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

  test("Regenerate leaves alone someone with no marks and no assessment", async () => {
    const a = await attendee("regen");
    assert.deepEqual(await regenerateParticipation(admin.id, a.id), { ok: false, error: "no_marks" });
    assert.equal(await participationRow(a.email), null);
  });

  test("Regenerate does not wait for Generate once someone has a mark", async () => {
    const a = await attendee("regen-marked");
    await adjustMark(judge.id, a.id, { descriptorId: positive.id, delta: 1 }, false);
    const ran = await regenerateParticipation(admin.id, a.id);
    // Claude is not set up here, which is the furthest a run without a key gets.
    if (!ran.ok) assert.equal(ran.error, "unconfigured");
    else assert.equal((await participationRow(a.email))?.averageScore, 2);
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
