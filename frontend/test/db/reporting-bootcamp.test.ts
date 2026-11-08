/**
 * Reporting → Live Sessions against a real database: who a reader may see,
 * as HiBob's reporting lines say today; what a manager sees of the active
 * bootcamp before and after its release; and an administrator's corrections.
 *
 * The org is employees whose ids carry the scope: a manager M, a lead L under
 * them and a rep R under L, and an outsider O under no one. Releasing touches
 * the active bootcamp, which may be someone else's in the scratch database, so
 * its release columns are put back afterwards. Everyone else's classes are
 * at complete bootcamps of the suite's own, released when made.
 */

import "../support/test-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { and, eq, inArray } from "drizzle-orm";

process.env.AUTH_SECRET ||= "reporting-bootcamp-test-secret-reporting-b";

import { db } from "@/db";
import {
  bootcampClassReviews,
  bootcamps,
  employees,
  evalsAssessmentCriteria,
  evalsAssessments,
  evalsSubmissions,
  evalsSubmissionScores,
  intakeResponses,
  releaseNoticeRuns,
  scorecardViews,
} from "@/db/schema";
import { IN_STAGE, isCandidate } from "@/lib/evals/current-cohort";
import { getCandidateCutoffs } from "@/lib/evals/settings";
import { BOOTCAMP_COHORT_LIST, BOOTCAMP_RECORD_LIST, RELEASE_NOTICE_LIST, RELEASE_NOTICE_MESSAGE_LIST } from "@/lib/list-specs";
import { listCardViewers, recordCardView } from "@/lib/reporting/card-views";
import {
  bootcampRecordCounts,
  classAttendees,
  classReviewSchema,
  cohortBootcamp,
  editSubmission,
  getBootcampPerson,
  listBootcampRecords,
  cohortCounts,
  listCohort,
  readerOf,
  releaseBlockers,
  releaseScores,
  saveClassReview,
  submissionEditSchema,
  unscoredAttendees,
  visibleStages,
  type BootcampReader,
} from "@/lib/reporting/bootcamp";
import { pendingOverall, suggestOverallFeedback } from "@/lib/reporting/overall-feedback";
import {
  countReleaseNoticeMessages,
  getReleaseNotice,
  listReleaseNoticeMessages,
  listReleaseNotices,
  startReleaseNotice,
} from "@/lib/reporting/release-notice";
import { PERSONAS } from "../support/access";
import { TEST_EMAIL_DOMAIN, TEST_PREFIX } from "../support/db";
import { testScope, type TestUser } from "../support/seed";

const scope = testScope("rboot");
const SCOPED = `${TEST_PREFIX}rboot_`;
const emailOf = (key: string) => `${SCOPED}${key}@${TEST_EMAIL_DOMAIN}`;

let admin: TestUser;
let bootcampId: string;
let submissionId: string;
/** The rep's BTC, carried over from the Sheet with no criteria. */
let repSubmissionId: string;
let restoreRelease: Pick<typeof bootcamps.$inferSelect, "btcReleasedAt" | "btcReleasedBy" | "intReleasedAt" | "intReleasedBy">;

const manager = () => readerOf({ access: PERSONAS.nobody, email: emailOf("manager") });
const lead = () => readerOf({ access: PERSONAS.nobody, email: emailOf("lead") });
const rep = () => readerOf({ access: PERSONAS.nobody, email: emailOf("rep") });
const viewer = () => readerOf({ access: PERSONAS.assessmentsViewer, email: null });

async function employee(key: string, reportsTo: string | null) {
  await db.insert(employees).values({
    id: `${SCOPED}${key}`,
    email: emailOf(key),
    fullName: `Person ${key}`,
    reportsToEmail: reportsTo ? emailOf(reportsTo) : "",
    raw: {},
  });
}

/** Gives the newcomer the built-in Participation assessment, scored `score`. */
async function participation(score: number) {
  const [built] = await db
    .select({ id: evalsAssessments.id, name: evalsAssessments.name })
    .from(evalsAssessments)
    .where(and(eq(evalsAssessments.builtIn, "participation"), eq(evalsAssessments.stage, "bootcamp")));
  await db
    .insert(evalsSubmissions)
    .values({ bootcampId, assessmentId: built!.id, attendeeEmail: emailOf("newcomer"), assessmentName: built!.name, averageScore: score, ownerId: admin.id })
    .onConflictDoNothing();
}

/** Everyone the reader may see who belongs to this suite, by email, with their level. */
async function seen(reader: ReturnType<typeof readerOf>) {
  const page = await listBootcampRecords(reader, { ...BOOTCAMP_RECORD_LIST, sort: "fullName", dir: "asc", q: SCOPED, page: 1 });
  return Object.fromEntries(page.rows.map((r) => [r.email, r.level]));
}

before(async () => {
  await scope.setUp();
  admin = await scope.createUser("admin", PERSONAS.assessmentsAdmin);
  bootcampId = await scope.activeBootcamp(admin.id);
  const [current] = await db.select().from(bootcamps).where(eq(bootcamps.id, bootcampId));
  restoreRelease = {
    btcReleasedAt: current!.btcReleasedAt,
    btcReleasedBy: current!.btcReleasedBy,
    intReleasedAt: current!.intReleasedAt,
    intReleasedBy: current!.intReleasedBy,
  };
  await db
    .update(bootcamps)
    .set({ btcReleasedAt: null, btcReleasedBy: null, intReleasedAt: null, intReleasedBy: null })
    .where(eq(bootcamps.id, bootcampId));

  await employee("manager", null);
  await employee("lead", "manager");
  await employee("rep", "lead");
  await employee("outsider", null);
  await scope.createAttendance(admin.id, emailOf("lead"), "bootcamp", "2025-03-03", 3.1);
  await scope.createAttendance(admin.id, emailOf("lead"), "intermediate", "2025-09-08", 3.4);
  repSubmissionId = await scope.createAttendance(admin.id, emailOf("rep"), "bootcamp", "2026-03-02", 2.8);
  await scope.createAttendance(admin.id, emailOf("outsider"), "bootcamp", "2026-03-02", 3.6);

  // The newcomer is scored at the active bootcamp, which nobody below Assessments sees until it is released.
  // They are a bootcamp candidate on Cohorts → Current too, so that releasing moves them on.
  await employee("newcomer", "lead");
  // Saving the registration form is what puts them in the cohort.
  await db.insert(intakeResponses).values({ form: "bootcamp", email: emailOf("newcomer"), answers: {} });
  await employee("no-rsvp", "lead");
  const today = new Date().toISOString().slice(0, 10);
  await db
    .update(employees)
    .set({ orgDepth: 2, track: "sales", startDate: today, activeEffectiveDate: today })
    .where(inArray(employees.id, [`${SCOPED}newcomer`, `${SCOPED}no-rsvp`]));
  const assessmentId = await scope.createAssessment(admin.id, `${SCOPED}Demo day`);
  const [criterion] = await db
    .select({ id: evalsAssessmentCriteria.id })
    .from(evalsAssessmentCriteria)
    .where(eq(evalsAssessmentCriteria.assessmentId, assessmentId));
  const [sub] = await db
    .insert(evalsSubmissions)
    .values({
      bootcampId,
      assessmentId,
      attendeeEmail: emailOf("newcomer"),
      assessmentName: `${SCOPED}Demo day`,
      averageScore: 3,
      ownerId: admin.id,
    })
    .returning({ id: evalsSubmissions.id });
  submissionId = sub!.id;
  await db.insert(evalsSubmissionScores).values({
    submissionId,
    criterionId: criterion!.id,
    criterionName: "Demo",
    score: 3,
    comment: "Clear and calm",
  });
});

after(async () => {
  // The active bootcamp is not the suite's, so its reviews of the suite's people go by hand.
  await db.delete(bootcampClassReviews).where(eq(bootcampClassReviews.attendeeEmail, emailOf("newcomer")));
  await db.update(bootcamps).set(restoreRelease).where(eq(bootcamps.id, bootcampId));
  await db.delete(intakeResponses).where(eq(intakeResponses.email, emailOf("newcomer")));
  await scope.tearDown();
});

describe("who a reader sees", () => {
  test("a manager sees everyone under them, every level down, and never themselves or anyone outside", async () => {
    assert.deepEqual(await seen(manager()), { [emailOf("lead")]: "intermediate", [emailOf("rep")]: "bootcamp" });
    assert.deepEqual(await seen(lead()), { [emailOf("rep")]: "bootcamp" });
    assert.deepEqual(await seen(rep()), {});
  });

  test("an Assessments Viewer sees everyone", async () => {
    assert.deepEqual(Object.keys(await seen(viewer())).sort(), [emailOf("lead"), emailOf("outsider"), emailOf("rep")]);
  });

  test("someone not signed in through an email sees no one", async () => {
    const nobody = readerOf({ access: PERSONAS.nobody, email: null });
    assert.deepEqual(await seen(nobody), {});
    assert.equal((await bootcampRecordCounts(nobody)).total, 0);
  });

  test("follows the reporting lines as the HiBob sync leaves them", async () => {
    await db.update(employees).set({ reportsToEmail: emailOf("outsider") }).where(eq(employees.id, `${SCOPED}rep`));
    try {
      assert.deepEqual(Object.keys(await seen(manager())), [emailOf("lead")]);
      assert.deepEqual(Object.keys(await seen(readerOf({ access: PERSONAS.nobody, email: emailOf("outsider") }))), [
        emailOf("rep"),
      ]);
    } finally {
      await db.update(employees).set({ reportsToEmail: emailOf("lead") }).where(eq(employees.id, `${SCOPED}rep`));
    }
  });

  test("a person's page is not found for someone outside the reader's org, and shows a manager no assessments", async () => {
    assert.equal(await getBootcampPerson(manager(), `${SCOPED}outsider`), null);
    const person = await getBootcampPerson(manager(), `${SCOPED}rep`);
    assert.equal(person?.email, emailOf("rep"));
    assert.equal(person?.records, null);
    assert.deepEqual(person?.classes.bootcamp, {
      date: "2026-03-02",
      score: 2.8,
      exercises: [{ name: "bootcamp attendance", score: 2.8, feedback: null }],
      positiveFeedback: "",
      constructiveFeedback: "",
      otherNotes: "",
      examAverage: null,
    });
    assert.equal(person?.classes.intermediate.date, null);

    const full = await getBootcampPerson(viewer(), `${SCOPED}rep`);
    assert.deepEqual(full?.records?.submissions.map((x) => x.id), [repSubmissionId]);
  });
});

describe("releasing a class", () => {
  test("a preview logs the message each manager in the chain would get, and sends nothing", async () => {
    await db
      .update(employees)
      .set({ managementChain: `${emailOf("lead")};${emailOf("manager")}` })
      .where(eq(employees.id, `${SCOPED}newcomer`));
    assert.ok((await classAttendees(bootcampId, "bootcamp")).includes(emailOf("newcomer")));
    const bootcamp = (await cohortBootcamp())!;
    const run = await startReleaseNotice({
      stage: "bootcamp",
      bootcamp: { id: bootcamp.id, startDate: bootcamp.startDate },
      attendees: [emailOf("newcomer")],
      actorId: admin.id,
      preview: true,
      reportingUrl: "https://example.test/reporting/bootcamp",
    });
    try {
      assert.equal(run.dryRun, true);
      assert.equal((await getReleaseNotice(run.runId))?.status, "running");
      await run.send();

      const done = (await getReleaseNotice(run.runId))!;
      assert.equal(done.status, "succeeded");
      assert.equal(done.preview, true);
      assert.equal(done.triggeredBy, "admin");
      const page = await listReleaseNoticeMessages(run.runId, { ...RELEASE_NOTICE_MESSAGE_LIST, q: SCOPED, page: 1 });
      assert.deepEqual(page.rows.map((m) => [m.email, m.action]), [
        [emailOf("lead"), "messaged"],
        [emailOf("manager"), "messaged"],
      ]);
      assert.match(page.rows[0]!.detail ?? "", /^Feedback has been released for .+ Bootcamp!  <https:\/\/example\.test\/reporting\/bootcamp\?cohort\.stage=bootcamp\|Click here>/);
      assert.equal(page.rows[0]!.fullName, "Person lead");
      const counts = await countReleaseNoticeMessages(run.runId);
      assert.equal(counts.all, done.messaged + done.notInSlack + done.failures);
      assert.equal(counts.all, done.recipients);
      assert.ok((await listReleaseNotices({ ...RELEASE_NOTICE_LIST, q: "", page: 1 })).rows.some((r) => r.id === run.runId));
    } finally {
      await db.delete(releaseNoticeRuns).where(eq(releaseNoticeRuns.id, run.runId));
    }
  });

  test("hides the active cohort's results from a manager entirely until released", async () => {
    const bootcamp = (await cohortBootcamp())!;
    const query = { ...BOOTCAMP_COHORT_LIST, q: SCOPED, page: 1 };
    assert.deepEqual(visibleStages(manager(), bootcamp), []);
    assert.deepEqual((await listCohort(manager(), bootcamp, query)).rows, []);
    const forViewer = await listCohort(viewer(), bootcamp, query);
    assert.deepEqual(
      forViewer.rows.map((r) => [r.email, r.stage, r.scored, r.averageScore]),
      [[emailOf("newcomer"), "bootcamp", 1, 3]],
    );

    const newcomer = (await getBootcampPerson(manager(), `${SCOPED}newcomer`))!;
    assert.equal(newcomer.classes.bootcamp.date, null, "not released, so not attended as far as a manager knows");
  });

  test("lists only those who RSVP'd, and not a candidate who has been deferred", async () => {
    const bootcamp = (await cohortBootcamp())!;
    const listed = async () =>
      (await listCohort(viewer(), bootcamp, { ...BOOTCAMP_COHORT_LIST, q: SCOPED, page: 1 })).rows.map((r) => r.email);
    assert.deepEqual(await listed(), [emailOf("newcomer")], "no-rsvp is a candidate who has not saved the form");
    const [rsvp] = await db
      .insert(intakeResponses)
      .values({ form: "bootcamp", email: emailOf("no-rsvp"), answers: {} })
      .returning({ id: intakeResponses.id });
    try {
      assert.deepEqual(await listed(), [emailOf("newcomer"), emailOf("no-rsvp")]);
      await db.update(employees).set({ track: "deferred" }).where(eq(employees.id, `${SCOPED}no-rsvp`));
      assert.deepEqual(await listed(), [emailOf("newcomer")]);
    } finally {
      await db.delete(intakeResponses).where(eq(intakeResponses.id, rsvp!.id));
      await db.update(employees).set({ track: "sales" }).where(eq(employees.id, `${SCOPED}no-rsvp`));
    }
  });

  test("waits until everyone in the cohort has every assessment, and names who holds it up", async () => {
    const bootcamp = (await cohortBootcamp())!;
    const missing = await unscoredAttendees(bootcamp, "bootcamp");
    assert.ok(missing.names.includes("Person newcomer"), "no Participation assessment yet");
    assert.equal(missing.names.includes("Person no-rsvp"), false);
    assert.deepEqual(await releaseScores(admin.id, "bootcamp"), { ok: false, error: "unscored" });

    await participation(3);
    assert.equal((await unscoredAttendees(bootcamp, "bootcamp")).names.includes("Person newcomer"), false);
    await db.update(evalsSubmissions).set({ averageScore: null }).where(eq(evalsSubmissions.id, submissionId));
    try {
      const waiting = await unscoredAttendees((await cohortBootcamp())!, "bootcamp");
      assert.ok(waiting.names.includes("Person newcomer"));
      assert.equal(waiting.total, waiting.names.length);
      assert.deepEqual(await releaseScores(admin.id, "bootcamp"), { ok: false, error: "unscored" });
      assert.equal((await cohortBootcamp())!.released.bootcamp, null);
    } finally {
      await db.update(evalsSubmissions).set({ averageScore: 3 }).where(eq(evalsSubmissions.id, submissionId));
    }
    assert.equal((await unscoredAttendees((await cohortBootcamp())!, "bootcamp")).names.includes("Person newcomer"), false);
  });

  test("waits on an exit exam and both sides of overall feedback, and names who holds it up", async () => {
    const bootcamp = (await cohortBootcamp())!;
    const blocked = async () => releaseBlockers(bootcamp, "bootcamp");
    const review = { bootcampId, stage: "bootcamp" as const, attendeeEmail: emailOf("newcomer") };

    // No review at all is waiting on both.
    assert.ok((await blocked()).noExitExam.names.includes("Person newcomer"));
    assert.ok((await blocked()).noFeedback.names.includes("Person newcomer"));
    assert.deepEqual(await releaseScores(admin.id, "bootcamp"), { ok: false, error: "no_exit_exam" });

    await db.insert(bootcampClassReviews).values({ ...review, entranceExam: 80, exitExam: 92, positiveFeedback: "Strong", constructiveFeedback: "  " });
    assert.equal((await blocked()).noExitExam.names.includes("Person newcomer"), false);
    assert.ok((await blocked()).noFeedback.names.includes("Person newcomer"), "blank constructive feedback still waits");
    assert.deepEqual(await releaseScores(admin.id, "bootcamp"), { ok: false, error: "no_feedback" });
    assert.equal((await cohortBootcamp())!.released.bootcamp, null);

    await db
      .update(bootcampClassReviews)
      .set({ constructiveFeedback: "Slow down in discovery" })
      .where(
        and(
          eq(bootcampClassReviews.bootcampId, bootcampId),
          eq(bootcampClassReviews.stage, "bootcamp"),
          eq(bootcampClassReviews.attendeeEmail, emailOf("newcomer")),
        ),
      );
    const after = await blocked();
    assert.equal(after.noExitExam.names.includes("Person newcomer"), false);
    assert.equal(after.noFeedback.names.includes("Person newcomer"), false);
  });

  test("shows a manager the class once released, and releasing again changes nothing", async () => {
    // Someone opened the card before the release, so there is now something they have not seen.
    await db.insert(scorecardViews).values({ attendeeEmail: emailOf("newcomer"), viewerId: admin.id });
    const first = await releaseScores(admin.id, "bootcamp");
    assert.ok(first.ok);
    assert.deepEqual(await db.select().from(scorecardViews).where(eq(scorecardViews.attendeeEmail, emailOf("newcomer"))), []);
    // The review was only there to let it release; the tests after this start without one.
    await db.delete(bootcampClassReviews).where(eq(bootcampClassReviews.attendeeEmail, emailOf("newcomer")));
    assert.ok(first.written >= 1);
    assert.equal(first.attendees.length, first.written);
    assert.ok(first.attendees.includes(emailOf("newcomer")));
    const again = await releaseScores(admin.id, "bootcamp");
    assert.ok(again.ok);
    assert.equal(again.releasedAt.getTime(), first.releasedAt.getTime());
    assert.equal(again.written, 0);
    assert.deepEqual(again.attendees, []);

    const bootcamp = (await cohortBootcamp())!;
    assert.equal(bootcamp.released.bootcamp?.byName, "admin");
    assert.deepEqual(visibleStages(manager(), bootcamp), ["bootcamp"]);
    const rows = (await listCohort(manager(), bootcamp, { ...BOOTCAMP_COHORT_LIST, q: SCOPED, page: 1 })).rows;
    assert.deepEqual(
      rows.map((r) => [r.email, r.stage]),
      [[emailOf("newcomer"), "bootcamp"]],
      "the BTC date its own release wrote keeps them in this bootcamp's BTC class",
    );
    // The rep's lead sees them too; the outsider, whose org they are not in, does not.
    const outsider = readerOf({ access: PERSONAS.nobody, email: emailOf("outsider") });
    assert.deepEqual((await listCohort(outsider, bootcamp, { ...BOOTCAMP_COHORT_LIST, q: SCOPED, page: 1 })).rows, []);

    const newcomer = (await getBootcampPerson(manager(), `${SCOPED}newcomer`))!;
    assert.equal(newcomer.classes.bootcamp.score, 3);
    assert.equal(newcomer.records, null);
    // Only Participation was there to let the release through; the corrections below score the demo alone.
    await db
      .delete(evalsSubmissions)
      .where(and(eq(evalsSubmissions.attendeeEmail, emailOf("newcomer")), eq(evalsSubmissions.assessmentName, "Participation")));
  });

  test("completes the class: everyone scored in it has attended it, which moves them on to Intermediate", async () => {
    const bootcamp = (await cohortBootcamp())!;
    const newcomer = (await getBootcampPerson(manager(), `${SCOPED}newcomer`))!;
    assert.equal(newcomer.classes.bootcamp.date, bootcamp.startDate);
    assert.equal(newcomer.classes.intermediate.date, null);

    const [candidate] = await db
      .select({ id: employees.id })
      .from(employees)
      .where(and(eq(employees.id, `${SCOPED}newcomer`), isCandidate(await getCandidateCutoffs()), IN_STAGE.intermediate));
    assert.ok(candidate, "an Intermediate candidate on Cohorts → Current");
  });
});

describe("an administrator's corrections", () => {
  test("rescore an assessment in place, keeping its owner, and refuse a stale or incomplete one", async () => {
    const [before] = await db.select().from(evalsSubmissions).where(eq(evalsSubmissions.id, submissionId));
    const [score] = await db.select().from(evalsSubmissionScores).where(eq(evalsSubmissionScores.submissionId, submissionId));
    const revises = before!.updatedAt.toISOString();

    assert.deepEqual(
      await editSubmission(admin.id, submissionId, {
        scores: [{ criterionId: score!.criterionId, score: 1, comment: "" }],
        positiveFeedback: "",
        constructiveFeedback: "",
        revises,
      }),
      { ok: false, error: "feedback_required" },
    );
    assert.deepEqual(
      await editSubmission(admin.id, submissionId, {
        scores: [{ criterionId: crypto.randomUUID(), score: 4, comment: "" }],
        positiveFeedback: "",
        constructiveFeedback: "",
        revises,
      }),
      { ok: false, error: "invalid" },
    );

    const saved = await editSubmission(admin.id, submissionId, {
      scores: [{ criterionId: score!.criterionId, score: 4, comment: "Outstanding close" }],
      positiveFeedback: "Owned the room",
      constructiveFeedback: "",
      revises,
    });
    assert.ok(saved.ok);
    assert.equal(saved.submission.averageScore, 4);
    const forManager = (await getBootcampPerson(manager(), `${SCOPED}newcomer`))!;
    assert.equal(forManager.classes.bootcamp.score, 4, "the class is released, so a manager sees the edit");

    const person = (await getBootcampPerson(viewer(), submissionId))!;
    const [shown] = person.records!.submissions;
    assert.equal(shown?.ownerName, "admin");
    assert.equal(shown?.positiveFeedback, "Owned the room");
    assert.deepEqual(shown?.scores.map((c) => [c.criterionName, c.score, c.comment]), [["Demo", 4, "Outstanding close"]]);

    assert.deepEqual(
      await editSubmission(admin.id, submissionId, {
        scores: [{ criterionId: score!.criterionId, score: 3, comment: "" }],
        positiveFeedback: "",
        constructiveFeedback: "",
        revises,
      }),
      { ok: false, error: "conflict" },
    );
  });

  test("set the score of an assessment scored on no criteria directly, with no feedback required", async () => {
    const [before] = await db.select().from(evalsSubmissions).where(eq(evalsSubmissions.id, repSubmissionId));
    const revises = before!.updatedAt.toISOString();
    const edit = { scores: [], positiveFeedback: "", constructiveFeedback: "", revises };

    assert.deepEqual(await editSubmission(admin.id, repSubmissionId, edit), { ok: false, error: "invalid" });
    assert.equal(
      submissionEditSchema.safeParse({ ...edit, averageScore: 3.25 }).success,
      false,
      "one decimal place at most",
    );

    const saved = await editSubmission(admin.id, repSubmissionId, { ...edit, averageScore: 1.5 });
    assert.ok(saved.ok);
    assert.equal(saved.submission.averageScore, 1.5);
    assert.equal((await getBootcampPerson(manager(), `${SCOPED}rep`))?.classes.bootcamp.score, 1.5);

    assert.deepEqual(await editSubmission(admin.id, repSubmissionId, { ...edit, averageScore: 2 }), {
      ok: false,
      error: "conflict",
    });
  });
});

describe("a class's overall review", () => {
  /** The bootcamp the lead's INT was at. */
  async function leadIntermediate() {
    const [row] = await db
      .select({ bootcampId: evalsSubmissions.bootcampId })
      .from(evalsSubmissions)
      .innerJoin(evalsAssessments, eq(evalsAssessments.id, evalsSubmissions.assessmentId))
      .where(and(eq(evalsSubmissions.attendeeEmail, emailOf("lead")), eq(evalsAssessments.stage, "intermediate")));
    return row!.bootcampId;
  }

  test("shows a manager its feedback and exam average, the exams counting as one more exercise", async () => {
    const leadBootcamp = await leadIntermediate();
    const input = classReviewSchema.parse({
      bootcampId: leadBootcamp,
      stage: "intermediate",
      positiveFeedback: "  Strong demos  ",
      constructiveFeedback: "Slow down",
      otherNotes: "Out sick on day two",
      entranceExam: 90,
      exitExam: 94,
      revises: null,
    });
    const saved = await saveClassReview(admin.id, `${SCOPED}lead`, input);
    assert.ok(saved.ok);
    assert.equal(saved.review.examAverage, 92);

    const person = await getBootcampPerson(manager(), `${SCOPED}lead`);
    // 3.4 from the assessment and 3 from a 92% exam average.
    assert.equal(person?.classes.intermediate.score, 3.2);
    assert.equal(person?.classes.intermediate.positiveFeedback, "Strong demos");
    assert.equal(person?.classes.intermediate.constructiveFeedback, "Slow down");
    assert.equal(person?.classes.intermediate.examAverage, 92);
    assert.equal(person?.classes.intermediate.otherNotes, "Out sick on day two");
    assert.deepEqual(person?.classes.intermediate.exercises.length, 1, "the exams are not listed as an exercise");
    assert.equal(person?.classes.bootcamp.examAverage, null, "a review is of one class");

    const full = await getBootcampPerson(viewer(), `${SCOPED}lead`);
    assert.deepEqual(
      full?.records?.reviews.map(({ entranceExam, exitExam }) => ({ entranceExam, exitExam })),
      [{ entranceExam: 90, exitExam: 94 }],
    );

    // One exam alone counts for nothing.
    const halfway = await saveClassReview(admin.id, `${SCOPED}lead`, {
      ...input,
      exitExam: null,
      revises: saved.review.updatedAt.toISOString(),
    });
    assert.ok(halfway.ok);
    const after = await getBootcampPerson(manager(), `${SCOPED}lead`);
    assert.equal(after?.classes.intermediate.score, 3.4);
    assert.equal(after?.classes.intermediate.examAverage, null);
  });

  test("shows a manager an assessment's positive feedback under a 4 and its constructive under a 1 or 2", async () => {
    const shown = async (averageScore: number) => {
      await db
        .update(evalsSubmissions)
        .set({ averageScore, positiveFeedback: "Great demo", constructiveFeedback: "Practise the demo" })
        .where(eq(evalsSubmissions.id, repSubmissionId));
      return (await getBootcampPerson(manager(), `${SCOPED}rep`))?.classes.bootcamp.exercises[0]?.feedback;
    };
    assert.equal(await shown(3.6), "Great demo", "3.6 rounds to 4");
    assert.equal(await shown(2.2), "Practise the demo");
    assert.equal(await shown(3), null);
    assert.equal(await shown(1), "Practise the demo");
  });

  test("refuses a stale save, a class they were not assessed in, and an exam outside 0 to 100", async () => {
    const leadBootcamp = await leadIntermediate();
    const input = {
      bootcampId: leadBootcamp,
      stage: "intermediate" as const,
      positiveFeedback: "",
      constructiveFeedback: "",
      otherNotes: "",
      entranceExam: 80,
      exitExam: 80,
    };
    assert.deepEqual(await saveClassReview(admin.id, `${SCOPED}lead`, { ...input, revises: null }), {
      ok: false,
      error: "conflict",
    });
    assert.deepEqual(
      await saveClassReview(admin.id, `${SCOPED}rep`, { ...input, revises: null }),
      { ok: false, error: "not_found" },
      "the rep was never at the lead's INT",
    );
    assert.equal(classReviewSchema.safeParse({ ...input, exitExam: 101, revises: null }).success, false);
    assert.equal(classReviewSchema.safeParse({ ...input, exitExam: 90.25, revises: null }).success, false);
  });

  test("counts the exams in the active cohort's average", async () => {
    const average = async () => {
      const page = await listCohort(viewer(), (await cohortBootcamp())!, {
        ...BOOTCAMP_COHORT_LIST,
        q: emailOf("newcomer"),
        page: 1,
      });
      return page.rows.find((r) => r.email === emailOf("newcomer"))!.averageScore;
    };
    const scores = await db
      .select({ score: evalsSubmissions.averageScore })
      .from(evalsSubmissions)
      .innerJoin(evalsAssessments, eq(evalsAssessments.id, evalsSubmissions.assessmentId))
      .where(and(eq(evalsSubmissions.bootcampId, bootcampId), eq(evalsSubmissions.attendeeEmail, emailOf("newcomer")), eq(evalsAssessments.stage, "bootcamp")));
    const counted = scores.flatMap((x) => (x.score === null ? [] : [x.score]));

    const saved = await saveClassReview(admin.id, `${SCOPED}newcomer`, {
      bootcampId,
      stage: "bootcamp",
      positiveFeedback: "",
      constructiveFeedback: "",
      otherNotes: "",
      entranceExam: 79,
      exitExam: 80,
      revises: null,
    });
    assert.ok(saved.ok);
    // 79.5% is below 80%, so the exams score 1.
    const expected = Math.round(((counted.reduce((a, b) => a + b, 0) + 1) * 10) / (counted.length + 1)) / 10;
    assert.equal(await average(), expected);
  });

  test("History shows the score the cohort does, and the cohort narrows to one class", async () => {
    const bootcamp = (await cohortBootcamp())!;
    const query = { ...BOOTCAMP_COHORT_LIST, q: emailOf("newcomer"), page: 1 };
    const inCohort = (await listCohort(viewer(), bootcamp, query)).rows.find((r) => r.email === emailOf("newcomer"))!;
    const history = await listBootcampRecords(viewer(), { ...BOOTCAMP_RECORD_LIST, q: emailOf("newcomer"), page: 1 });
    const inHistory = history.rows.find((r) => r.email === emailOf("newcomer"))!;
    assert.deepEqual(
      [inHistory.level, inHistory.averageScore, inHistory.scored, inHistory.date],
      [inCohort.stage, inCohort.averageScore, inCohort.scored, inCohort.date],
    );

    assert.deepEqual((await listCohort(viewer(), bootcamp, query, "bootcamp")).rows.map((r) => r.email), [emailOf("newcomer")]);
    assert.deepEqual((await listCohort(viewer(), bootcamp, query, "intermediate")).rows, []);
    const counts = await cohortCounts(viewer(), bootcamp);
    assert.ok(counts.bootcamp >= 1);
    // A manager sees counts only for the classes released to them.
    assert.equal((await cohortCounts(manager(), bootcamp)).intermediate, 0);
  });

  test("records who opens a card, once per person, and names them on both lists", async () => {
    const key = `${SCOPED}newcomer`;
    const opener = () => readerOf({ access: PERSONAS.assessmentsViewer, email: null, id: admin.id });
    assert.deepEqual(await recordCardView(admin.id, opener(), key), { email: emailOf("newcomer") });
    assert.ok(await recordCardView(admin.id, opener(), key));
    const viewers = (await listCardViewers(opener(), key))!;
    const mine = viewers.viewers.find((v) => v.name === "admin")!;
    assert.equal(viewers.viewers.filter((v) => v.name === "admin").length, 1, "two opens are one viewer");
    assert.equal(mine.views, 2);

    const q = emailOf("newcomer");
    const rowsFor = async (reader: BootcampReader) => [
      (await listCohort(reader, (await cohortBootcamp())!, { ...BOOTCAMP_COHORT_LIST, q, page: 1 })).rows[0]!,
      (await listBootcampRecords(reader, { ...BOOTCAMP_RECORD_LIST, q, page: 1 })).rows[0]!,
    ];
    for (const row of await rowsFor(opener())) {
      assert.equal(row.viewerCount, viewers.total);
      assert.equal(row.viewers[0]?.name, "admin");
    }

    // Someone who has not opened it themself sees no one who has.
    for (const row of await rowsFor(viewer())) {
      assert.equal(row.viewerCount, 0);
      assert.deepEqual(row.viewers, []);
    }
    assert.deepEqual(await listCardViewers(viewer(), key), { viewers: [], total: 0 });

    // Someone who may not see the card records nothing.
    const outsider = readerOf({ access: PERSONAS.nobody, email: emailOf("outsider") });
    assert.equal(await recordCardView(admin.id, outsider, key), null);
    assert.equal(await listCardViewers(outsider, key), null);
  });
});

describe("Claude's overall feedback", () => {
  test("counts a blank overall side the cohort's assessment feedback could fill, and stops counting once it is written", async () => {
    const bootcamp = (await cohortBootcamp())!;
    const newcomer = and(eq(evalsSubmissions.bootcampId, bootcampId), eq(evalsSubmissions.attendeeEmail, emailOf("newcomer")));
    await db.update(evalsSubmissions).set({ positiveFeedback: "", constructiveFeedback: "" }).where(newcomer);
    const before = await pendingOverall(bootcamp, "bootcamp");

    await db.update(evalsSubmissions).set({ positiveFeedback: "Calm presenter" }).where(eq(evalsSubmissions.id, submissionId));
    assert.equal(await pendingOverall(bootcamp, "bootcamp"), before + 1, "the positive side, and not the constructive with nothing to sum up");

    await db
      .insert(bootcampClassReviews)
      .values({ bootcampId, stage: "bootcamp", attendeeEmail: emailOf("newcomer"), positiveFeedback: "Already written" })
      .onConflictDoUpdate({
        target: [bootcampClassReviews.bootcampId, bootcampClassReviews.stage, bootcampClassReviews.attendeeEmail],
        set: { positiveFeedback: "Already written" },
      });
    assert.equal(await pendingOverall(bootcamp, "bootcamp"), before);
  });

  test("writes one side only from feedback there is, for a class the person was assessed in", async () => {
    await db
      .update(evalsSubmissions)
      .set({ constructiveFeedback: "" })
      .where(and(eq(evalsSubmissions.bootcampId, bootcampId), eq(evalsSubmissions.attendeeEmail, emailOf("newcomer"))));
    assert.deepEqual(await suggestOverallFeedback(`${SCOPED}newcomer`, bootcampId, "bootcamp", "constructive"), {
      ok: false,
      error: "no_feedback",
    });
    assert.deepEqual(await suggestOverallFeedback(`${SCOPED}rep`, bootcampId, "bootcamp", "positive"), {
      ok: false,
      error: "not_found",
    });
    assert.deepEqual(await suggestOverallFeedback(`${SCOPED}nobody`, bootcampId, "bootcamp", "positive"), {
      ok: false,
      error: "not_found",
    });
  });
});
