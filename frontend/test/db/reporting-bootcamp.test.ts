/**
 * Reporting → Bootcamp against a real database: who a reader may see, as
 * HiBob's reporting lines say today; what a manager sees of the active
 * bootcamp before and after its release; and an administrator's corrections.
 *
 * The org is employees whose ids carry the scope: a manager M, a lead L under
 * them and a rep R under L, and an outsider O under no one. Releasing touches
 * the active bootcamp, which may be someone else's in the scratch database, so
 * its release columns are put back afterwards. Releasing also writes the
 * class to bootcamp history for everyone scored in it, which is only the
 * newcomer here, whose row goes with the scope's.
 */

import "../support/test-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";

process.env.AUTH_SECRET ||= "reporting-bootcamp-test-secret-reporting-b";

import { db } from "@/db";
import { bootcampHistory, bootcamps, employees, evalsAssessmentCriteria, evalsSubmissions, evalsSubmissionScores } from "@/db/schema";
import { IN_STAGE, isCandidate } from "@/lib/evals/current-cohort";
import { getCandidateCutoffs } from "@/lib/evals/settings";
import { BOOTCAMP_COHORT_LIST, BOOTCAMP_RECORD_LIST } from "@/lib/list-specs";
import {
  bootcampRecordCounts,
  cohortBootcamp,
  correctHistory,
  editSubmission,
  getBootcampPerson,
  listBootcampRecords,
  listCohort,
  readerOf,
  releaseScores,
  visibleStages,
} from "@/lib/reporting/bootcamp";
import { PERSONAS } from "../support/access";
import { TEST_EMAIL_DOMAIN, TEST_PREFIX } from "../support/db";
import { testScope, type TestUser } from "../support/seed";

const scope = testScope("rboot");
const SCOPED = `${TEST_PREFIX}rboot_`;
const emailOf = (key: string) => `${SCOPED}${key}@${TEST_EMAIL_DOMAIN}`;

let admin: TestUser;
let bootcampId: string;
let submissionId: string;
let historyIds: Record<"lead" | "rep" | "outsider", string>;
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

async function history(key: string, values: Partial<typeof bootcampHistory.$inferInsert>) {
  const [row] = await db
    .insert(bootcampHistory)
    .values({ email: emailOf(key), ...values })
    .returning({ id: bootcampHistory.id });
  return row!.id;
}

/** Everyone the reader may see who belongs to this suite, by email, with their level. */
async function seen(reader: ReturnType<typeof readerOf>) {
  const page = await listBootcampRecords(reader, { ...BOOTCAMP_RECORD_LIST, sort: "email", dir: "asc", q: SCOPED, page: 1 });
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
  historyIds = {
    lead: await history("lead", { btcDate: "2025-03-03", btcScore: 3.1, intDate: "2025-09-08", intScore: 3.4 }),
    rep: await history("rep", { btcDate: "2026-03-02", btcScore: 2.8, btcIndividualScores: { "Score-Exams": 3 } }),
    outsider: await history("outsider", { btcDate: "2026-03-02", btcScore: 3.6 }),
  };

  // The newcomer is scored at the active bootcamp, which nobody below Assessments sees until it is released.
  // They are a bootcamp candidate on Cohorts → Current too, so that releasing moves them on.
  await employee("newcomer", "lead");
  const today = new Date().toISOString().slice(0, 10);
  await db
    .update(employees)
    .set({ orgDepth: 2, track: "sales", startDate: today, activeEffectiveDate: today })
    .where(eq(employees.id, `${SCOPED}newcomer`));
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
  await db.update(bootcamps).set(restoreRelease).where(eq(bootcamps.id, bootcampId));
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
    assert.equal(await getBootcampPerson(manager(), historyIds.outsider), null);
    const person = await getBootcampPerson(manager(), historyIds.rep);
    assert.equal(person?.email, emailOf("rep"));
    assert.equal(person?.records, null);
    assert.deepEqual(person?.classes.bootcamp, { date: "2026-03-02", score: 2.8, exercises: [{ name: "Exams", score: 3 }] });

    const full = await getBootcampPerson(viewer(), historyIds.rep);
    assert.equal(full?.records?.history?.id, historyIds.rep);
  });
});

describe("releasing a class", () => {
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

  test("shows a manager the class once released, and releasing again changes nothing", async () => {
    const first = await releaseScores(admin.id, "bootcamp");
    assert.ok(first.ok);
    assert.ok(first.written >= 1);
    const again = await releaseScores(admin.id, "bootcamp");
    assert.ok(again.ok);
    assert.equal(again.releasedAt.getTime(), first.releasedAt.getTime());
    assert.equal(again.written, 0);

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
  });

  test("completes the class: writes its day and scores to bootcamp history, which moves them on to Intermediate", async () => {
    const bootcamp = (await cohortBootcamp())!;
    const [row] = await db.select().from(bootcampHistory).where(eq(bootcampHistory.email, emailOf("newcomer")));
    assert.equal(row?.btcDate, bootcamp.startDate);
    assert.equal(row?.btcScore, 3);
    assert.deepEqual(row?.btcIndividualScores, { [`${SCOPED}Demo day`]: 3 });
    assert.equal(row?.intDate, null);
    assert.equal(row?.updatedBy, admin.id);

    const [candidate] = await db
      .select({ id: employees.id })
      .from(employees)
      .leftJoin(bootcampHistory, eq(bootcampHistory.email, employees.email))
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
    const [written] = await db.select().from(bootcampHistory).where(eq(bootcampHistory.email, emailOf("newcomer")));
    assert.equal(written?.btcScore, 4, "the class is released, so its history follows the edit");
    assert.deepEqual(written?.btcIndividualScores, { [`${SCOPED}Demo day`]: 4 });

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

  test("correct a history row's days and scores, saying whose it was", async () => {
    const result = await correctHistory(admin.id, historyIds.rep, {
      intDate: "2026-09-14",
      intScore: 3.2,
      intIndividualScores: { "Score-Demo": 3.5 },
    });
    assert.deepEqual(result, { ok: true, email: emailOf("rep") });
    const [row] = await db.select().from(bootcampHistory).where(eq(bootcampHistory.id, historyIds.rep));
    assert.equal(row?.intDate, "2026-09-14");
    assert.equal(row?.intScore, 3.2);
    assert.deepEqual(row?.intIndividualScores, { "Score-Demo": 3.5 });
    assert.equal(row?.btcScore, 2.8, "a field left out keeps its value");
    assert.equal(row?.updatedBy, admin.id);
    assert.equal((await seen(manager()))[emailOf("rep")], "intermediate");

    assert.deepEqual(await correctHistory(admin.id, crypto.randomUUID(), { btcScore: 3 }), {
      ok: false,
      error: "not_found",
    });
  });
});
