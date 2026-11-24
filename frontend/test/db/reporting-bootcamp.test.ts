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
import { getOrgLeaderEmail } from "@/lib/evals/settings";
import {
  bootcampClassReviews,
  bootcampRegistrations,
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
import {
  BOOTCAMP_COHORT_LIST,
  BOOTCAMP_RECORD_LIST,
  CURRENT_COHORT_LIST,
  RELEASE_NOTICE_LIST,
  RELEASE_NOTICE_MESSAGE_LIST,
} from "@/lib/list-specs";
import { nextClassOf, register } from "@/lib/cohorts/registrations";
import { answeredIntake, getMyIntake } from "@/lib/logistics/intake";
import { listCurrentCohort } from "@/lib/evals/current-cohort";
import { listCardViewers, recordCardView } from "@/lib/reporting/card-views";
import {
  bootcampRecordCounts,
  classAttendees,
  classReviewSchema,
  classStages,
  cohortBootcamp,
  editSubmission,
  getBootcampPerson,
  graduatesBootcamp,
  listBootcampRecords,
  listLiveSessions,
  liveSessionsContext,
  liveSessionsFilters,
  cohortCounts,
  canReach,
  listCohort,
  readerOf,
  releaseBlockers,
  releaseScores,
  saveClassReview,
  submissionEditSchema,
  unscoredAttendees,
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
    // Under the Organization Leader, as the HiBob sync leaves everyone a reader may reach.
    orgDepth: 1,
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
    .values({
      bootcampId,
      assessmentId: built!.id,
      attendeeEmail: emailOf("newcomer"),
      assessmentName: built!.name,
      averageScore: score,
      ownerId: admin.id,
    })
    .onConflictDoNothing();
}

/** Everyone the reader may see who belongs to this suite, by email, with their level. */
async function seen(reader: ReturnType<typeof readerOf>) {
  const page = await listBootcampRecords(reader, { ...BOOTCAMP_RECORD_LIST, sort: "fullName", dir: "asc", q: SCOPED, page: 1 });
  return Object.fromEntries(page.rows.map((r) => [r.email, r.level]));
}

/** One page of Live Sessions' table as the reader would ask for it with `params`, this suite's people only. */
async function table(reader: BootcampReader, params: Record<string, string> = {}) {
  const context = await liveSessionsContext(reader);
  const filters = liveSessionsFilters(context, (name) => params[name]);
  const page = await listLiveSessions(reader, context, filters, { ...BOOTCAMP_RECORD_LIST, q: SCOPED, page: 1 });
  return { context, filters, rows: page.rows };
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
  // Saving the registration form is what puts them in the class: its answers, and their registration for this bootcamp.
  await db.insert(intakeResponses).values({ form: "bootcamp", email: emailOf("newcomer"), answers: {} });
  await db.insert(bootcampRegistrations).values({ bootcampId, stage: "bootcamp", email: emailOf("newcomer") });
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
  await db.delete(bootcampRegistrations).where(inArray(bootcampRegistrations.email, [emailOf("newcomer"), emailOf("no-rsvp")]));
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
    await db
      .update(employees)
      .set({ reportsToEmail: emailOf("outsider") })
      .where(eq(employees.id, `${SCOPED}rep`));
    try {
      assert.deepEqual(Object.keys(await seen(manager())), [emailOf("lead")]);
      assert.deepEqual(Object.keys(await seen(readerOf({ access: PERSONAS.nobody, email: emailOf("outsider") }))), [emailOf("rep")]);
    } finally {
      await db
        .update(employees)
        .set({ reportsToEmail: emailOf("lead") })
        .where(eq(employees.id, `${SCOPED}rep`));
    }
  });

  test("someone above the Organization Leader sees no one, even the people who report up to them", async () => {
    await employee("chief", null);
    await db
      .update(employees)
      .set({ orgDepth: null })
      .where(eq(employees.id, `${SCOPED}chief`));
    await db
      .update(employees)
      .set({ reportsToEmail: emailOf("chief") })
      .where(eq(employees.id, `${SCOPED}manager`));
    try {
      assert.deepEqual(await seen(readerOf({ access: PERSONAS.nobody, email: emailOf("chief") })), {});
    } finally {
      await db
        .update(employees)
        .set({ reportsToEmail: "" })
        .where(eq(employees.id, `${SCOPED}manager`));
    }
  });

  test("someone outside the leader's organization is reached by their direct manager alone", async () => {
    await employee("boss", null);
    await employee("stray", "boss");
    await employee("above", null);
    await db
      .update(employees)
      .set({ orgDepth: null })
      .where(inArray(employees.id, [`${SCOPED}boss`, `${SCOPED}stray`, `${SCOPED}above`]));
    await db
      .update(employees)
      .set({ reportsToEmail: emailOf("above") })
      .where(eq(employees.id, `${SCOPED}boss`));
    const reach = (who: string, whom: string) => canReach(readerOf({ access: PERSONAS.nobody, email: emailOf(who) }), emailOf(whom));
    assert.equal(await reach("boss", "stray"), true);
    assert.equal(await reach("above", "stray"), false);
    assert.equal(await reach("stray", "boss"), false);
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
    assert.deepEqual(
      full?.records?.submissions.map((x) => x.id),
      [repSubmissionId],
    );
  });
});

describe("releasing a class", () => {
  test("a preview logs the message each manager in the chain would get, and sends nothing", async () => {
    await db
      .update(employees)
      // The chain runs on past the Organization Leader to someone above them, who must not be told.
      .set({ managementChain: `${emailOf("lead")};${emailOf("manager")};${await getOrgLeaderEmail()};${emailOf("chief")}` })
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
      assert.deepEqual(
        page.rows.map((m) => [m.email, m.action]),
        [
          [emailOf("lead"), "messaged"],
          [emailOf("manager"), "messaged"],
        ],
      );
      assert.match(
        page.rows[0]!.detail ?? "",
        /^Feedback has been released for .+ Bootcamp!  <https:\/\/example\.test\/reporting\/bootcamp\?stage=bootcamp\|Click here>/,
      );
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
    assert.deepEqual(classStages(manager(), bootcamp), []);
    assert.ok(classStages(viewer(), bootcamp).includes("bootcamp"));
    assert.deepEqual((await listCohort(manager(), bootcamp, query)).rows, []);
    const forViewer = await listCohort(viewer(), bootcamp, query);
    assert.deepEqual(
      forViewer.rows.map((r) => [r.email, r.stage, r.scored, r.averageScore]),
      [[emailOf("newcomer"), "bootcamp", 1, 3]],
    );

    // On Live Sessions the class is the viewer's to switch to, and never a manager's, however they ask.
    const managerTable = await table(manager(), { show: "class" });
    assert.equal(managerTable.context.class, null);
    assert.notEqual(managerTable.filters.show, "class");
    assert.equal(
      managerTable.rows.some((r) => r.email === emailOf("newcomer")),
      false,
    );
    assert.ok(managerTable.rows.every((r) => r.inClass === null));
    const viewerTable = await table(viewer(), { show: "class" });
    assert.equal(viewerTable.filters.show, "class");
    const inClass = viewerTable.rows.find((r) => r.email === emailOf("newcomer"));
    assert.deepEqual([inClass?.level, inClass?.inClass, inClass?.averageScore], ["bootcamp", "bootcamp", 3]);
    assert.ok((await cohortCounts(viewer(), bootcamp)).bootcamp >= 1);
    assert.deepEqual(await cohortCounts(manager(), bootcamp), { bootcamp: 0, intermediate: 0 });

    const newcomer = (await getBootcampPerson(manager(), `${SCOPED}newcomer`))!;
    assert.equal(newcomer.classes.bootcamp.date, null, "not released, so not attended as far as a manager knows");
  });

  test("lists only those registered for this bootcamp, and not one who has been deferred since", async () => {
    const bootcamp = (await cohortBootcamp())!;
    const listed = async () =>
      (await listCohort(viewer(), bootcamp, { ...BOOTCAMP_COHORT_LIST, q: SCOPED, page: 1 })).rows.map((r) => r.email);
    assert.deepEqual(await listed(), [emailOf("newcomer")], "no-rsvp is a candidate who has not registered");
    // Answers saved for no bootcamp in particular, as before registrations, put no one in a class.
    const [rsvp] = await db
      .insert(intakeResponses)
      .values({ form: "bootcamp", email: emailOf("no-rsvp"), answers: {} })
      .returning({ id: intakeResponses.id });
    // A registration for another bootcamp's class is not one for this.
    const [elsewhere] = await db
      .insert(bootcamps)
      .values({ startDate: "2099-01-04", btcDays: 4, intDays: 3, status: "scheduled", createdBy: admin.id })
      .returning({ id: bootcamps.id });
    try {
      await db.insert(bootcampRegistrations).values({ bootcampId: elsewhere!.id, stage: "bootcamp", email: emailOf("no-rsvp") });
      assert.deepEqual(await listed(), [emailOf("newcomer")]);

      await db.insert(bootcampRegistrations).values({ bootcampId, stage: "bootcamp", email: emailOf("no-rsvp") });
      assert.deepEqual(await listed(), [emailOf("newcomer"), emailOf("no-rsvp")]);
      await db
        .update(employees)
        .set({ track: "deferred" })
        .where(eq(employees.id, `${SCOPED}no-rsvp`));
      assert.deepEqual(await listed(), [emailOf("newcomer")]);
      assert.equal((await unscoredAttendees(bootcamp, "bootcamp")).names.includes("Person no-rsvp"), false);
    } finally {
      await db.delete(intakeResponses).where(eq(intakeResponses.id, rsvp!.id));
      await db.delete(bootcampRegistrations).where(eq(bootcampRegistrations.email, emailOf("no-rsvp")));
      await db.delete(bootcamps).where(eq(bootcamps.id, elsewhere!.id));
      await db
        .update(employees)
        .set({ track: "sales" })
        .where(eq(employees.id, `${SCOPED}no-rsvp`));
    }
  });

  test("saving the form registers for the class it offers, and saving again keeps the one registration", async () => {
    const next = (await nextClassOf("bootcamp"))!;
    assert.equal(next.id, bootcampId, "the active bootcamp is the next one");
    const mine = and(eq(bootcampRegistrations.email, emailOf("no-rsvp")), eq(bootcampRegistrations.stage, "bootcamp"));
    try {
      assert.deepEqual(await register("bootcamp", emailOf("no-rsvp").toUpperCase(), false), next);
      const [first] = await db.select().from(bootcampRegistrations).where(mine);
      assert.equal(first?.bootcampId, bootcampId);
      await register("bootcamp", emailOf("no-rsvp"), false);
      const again = await db.select().from(bootcampRegistrations).where(mine);
      assert.equal(again.length, 1);
      assert.equal(again[0]!.registeredAt.getTime(), first!.registeredAt.getTime());
      assert.ok(again[0]!.updatedAt.getTime() >= first!.updatedAt.getTime());
    } finally {
      await db.delete(bootcampRegistrations).where(mine);
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

    await db
      .insert(bootcampClassReviews)
      .values({ ...review, entranceExam: 80, exitExam: 92, positiveFeedback: "Strong", constructiveFeedback: "  " });
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
    assert.deepEqual(
      await db
        .select()
        .from(scorecardViews)
        .where(eq(scorecardViews.attendeeEmail, emailOf("newcomer"))),
      [],
    );
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
    // Released, the class is its graduates', and no longer one being judged.
    assert.equal(classStages(viewer(), bootcamp).includes("bootcamp"), false);
    assert.deepEqual((await listCohort(viewer(), bootcamp, { ...BOOTCAMP_COHORT_LIST, q: SCOPED, page: 1 }, "bootcamp")).rows, []);
    const graduates = (await graduatesBootcamp())!;
    assert.equal(graduates.id, bootcampId);
    assert.deepEqual(graduates.stages, ["bootcamp"]);

    // A manager's table opens on the graduates, who are theirs to see once released.
    const { filters, rows } = await table(manager());
    assert.equal(filters.show, "graduates");
    assert.deepEqual(
      rows.map((r) => [r.email, r.level, r.graduated, r.inClass]),
      [[emailOf("newcomer"), "bootcamp", "bootcamp", null]],
      "the rep and the lead graduated from an older bootcamp, so they are only in everyone",
    );
    assert.ok((await bootcampRecordCounts(manager())).graduates.bootcamp >= 1);
    const everyone = (await table(manager(), { show: "all" })).rows.map((r) => r.email);
    assert.deepEqual(everyone.sort(), [emailOf("lead"), emailOf("newcomer"), emailOf("rep")]);
    // The rep's lead sees them too; the outsider, whose org they are not in, does not.
    const outsider = readerOf({ access: PERSONAS.nobody, email: emailOf("outsider") });
    assert.deepEqual((await table(outsider)).rows, []);

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
    assert.deepEqual(
      shown?.scores.map((c) => [c.criterionName, c.score, c.comment]),
      [["Demo", 4, "Outstanding close"]],
    );

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
    assert.equal(submissionEditSchema.safeParse({ ...edit, averageScore: 3.25 }).success, false, "one decimal place at most");

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

  test("counts the exams in the graduates' average", async () => {
    const average = async () => (await table(viewer())).rows.find((r) => r.email === emailOf("newcomer"))!.averageScore;
    const scores = await db
      .select({ score: evalsSubmissions.averageScore })
      .from(evalsSubmissions)
      .innerJoin(evalsAssessments, eq(evalsAssessments.id, evalsSubmissions.assessmentId))
      .where(
        and(
          eq(evalsSubmissions.bootcampId, bootcampId),
          eq(evalsSubmissions.attendeeEmail, emailOf("newcomer")),
          eq(evalsAssessments.stage, "bootcamp"),
        ),
      );
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

  test("the graduates narrow to a class they hold, and ignore one they do not", async () => {
    const graduates = (await graduatesBootcamp())!;
    const btc = await table(viewer(), { stage: "bootcamp" });
    assert.equal(btc.filters.stage, "bootcamp");
    assert.ok(btc.rows.some((r) => r.email === emailOf("newcomer")));
    assert.ok(btc.rows.every((r) => r.graduated === "bootcamp"));
    // Its intermediate class is not released, so asking for it narrows nothing.
    const int = await table(viewer(), { stage: "intermediate" });
    assert.equal(int.filters.stage, graduates.stages.includes("intermediate") ? "intermediate" : null);
    // Everyone is not narrowed by class at all.
    assert.equal((await table(viewer(), { show: "all", stage: "bootcamp" })).filters.stage, null);
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
      (await table(reader)).rows.find((r) => r.email === q)!,
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
    assert.equal(
      await pendingOverall(bootcamp, "bootcamp"),
      before + 1,
      "the positive side, and not the constructive with nothing to sum up",
    );

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

describe("the current cohort's bootcamp", () => {
  test("is the active one, or with none active the latest complete one that has started", async () => {
    assert.equal((await cohortBootcamp())?.id, bootcampId);

    const today = new Date().toISOString().slice(0, 10);
    const later = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const made = await db
      .insert(bootcamps)
      .values([
        // Not started yet, so never the cohort's, complete or not.
        { startDate: later, btcDays: 4, intDays: 3, status: "complete", createdBy: admin.id },
        // Two on the same day: the scored one wins over the one saved last.
        { startDate: today, btcDays: 4, intDays: 3, status: "complete", createdBy: admin.id, updatedAt: new Date(Date.now() - 60_000) },
        { startDate: today, btcDays: 4, intDays: null, status: "complete", createdBy: admin.id },
      ])
      .returning({ id: bootcamps.id });
    const [, scored, unscored] = made.map((b) => b.id);
    const assessmentId = await scope.createAssessment(admin.id, `${SCOPED}Fallback day`);
    const [sub] = await db
      .insert(evalsSubmissions)
      .values({
        bootcampId: scored!,
        assessmentId,
        attendeeEmail: emailOf("outsider"),
        assessmentName: `${SCOPED}Fallback day`,
        averageScore: 3,
        ownerId: admin.id,
      })
      .returning({ id: evalsSubmissions.id });
    try {
      // The active one still wins over any complete one.
      assert.equal((await cohortBootcamp())?.id, bootcampId);

      await db.update(bootcamps).set({ status: "complete" }).where(eq(bootcamps.id, bootcampId));
      const fallback = await cohortBootcamp();
      assert.equal(fallback?.id, scored);
      assert.equal(fallback?.intermediate, true);

      await db.delete(evalsSubmissions).where(eq(evalsSubmissions.id, sub!.id));
      assert.equal((await cohortBootcamp())?.id, unscored);
    } finally {
      await db.update(bootcamps).set({ status: "active" }).where(eq(bootcamps.id, bootcampId));
      await db.delete(evalsSubmissions).where(eq(evalsSubmissions.id, sub!.id));
      await db.delete(bootcamps).where(
        inArray(
          bootcamps.id,
          made.map((b) => b.id),
        ),
      );
    }
    assert.equal((await cohortBootcamp())?.id, bootcampId);
  });
});

describe("answering the registration form", () => {
  test("is registering for the next class, so a registration for an earlier one asks again", async () => {
    const lower = emailOf("no-rsvp");
    const unanswered = async () =>
      (
        await listCurrentCohort(
          { stage: "bootcamp", track: null, unanswered: true },
          { ...CURRENT_COHORT_LIST, q: lower, page: 1, sort: "email", dir: "asc" },
        )
      ).rows.some((m) => m.email === lower);
    // They answered for an earlier bootcamp they never came to.
    const [earlier] = await db
      .insert(bootcamps)
      .values({ startDate: "2026-05-04", btcDays: 4, intDays: 3, status: "complete", createdBy: admin.id })
      .returning({ id: bootcamps.id });
    const answers = { attend: "Yes" };
    const [saved] = await db
      .insert(intakeResponses)
      .values({ form: "bootcamp", email: lower, answers, submittedAt: new Date("2026-04-20T12:00:00Z") })
      .returning({ submittedAt: intakeResponses.submittedAt });
    await db.insert(bootcampRegistrations).values({ bootcampId: earlier!.id, stage: "bootcamp", email: lower });
    try {
      assert.equal(await unanswered(), true, "no RSVP mark, and the reminders count them");
      assert.deepEqual(await answeredIntake("bootcamp", [lower]), new Set());
      const mine = (await getMyIntake(lower))!;
      assert.equal(mine.savedAt, null, "their form is to do again");
      assert.deepEqual(mine.carriedFrom, { form: "bootcamp", savedAt: saved!.submittedAt.toISOString() });
      assert.deepEqual(mine.answers, answers, "starting from what they said last time");

      await register("bootcamp", lower, false);
      assert.equal(await unanswered(), false);
      assert.deepEqual(await answeredIntake("bootcamp", [lower]), new Set([lower]));
      const now = (await getMyIntake(lower))!;
      assert.equal(now.savedAt, saved!.submittedAt.toISOString());
      assert.equal(now.carriedFrom, undefined);
    } finally {
      await db.delete(intakeResponses).where(eq(intakeResponses.email, lower));
      await db.delete(bootcampRegistrations).where(eq(bootcampRegistrations.email, lower));
      await db.delete(bootcamps).where(eq(bootcamps.id, earlier!.id));
    }
  });
});
