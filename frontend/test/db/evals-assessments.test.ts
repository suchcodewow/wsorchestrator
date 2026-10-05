/**
 * eVals assessments and scoring against a real database: what an edit may
 * change once someone is scored, who an assessment's attendees are, and the
 * one submission per attendee that anyone may revise and whoever saves last
 * owns.
 *
 * Scoring needs an active bootcamp. One already in the scratch database is
 * used as it is; otherwise the suite makes one, and cleanup removes it.
 * Assessments are made by this suite's users, so cleanup finds them and the
 * scores on them; employees carry `TEST_PREFIX`.
 */

import "../support/test-env";

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { eq, like } from "drizzle-orm";

process.env.AUTH_SECRET ||= "evals-assessments-test-secret-evals-assess";

import { db } from "@/db";
import { employees, evalsAssessmentCriteria, type EmployeeTrack } from "@/db/schema";
import {
  createAssessment,
  deleteAssessment,
  getAssessment,
  listAssessments,
  updateAssessment,
  type AssessmentInput,
} from "@/lib/evals/assessments";
import { cohortScoring, listCurrentCohort } from "@/lib/evals/current-cohort";
import {
  getScoringForm,
  listAttendees,
  attendeeCounts,
  saveSubmission,
  scoringAssessment,
  type SubmissionInput,
} from "@/lib/evals/scoring";
import { ASSESSMENT_ATTENDEE_LIST, ASSESSMENT_LIST, CURRENT_COHORT_LIST, MY_MENTION_LIST } from "@/lib/list-specs";
import { listMyMentions } from "@/lib/mention-store";
import { PERSONAS } from "../support/access";
import { TEST_EMAIL_DOMAIN, TEST_PREFIX } from "../support/db";
import { testScope, type TestUser } from "../support/seed";

const scope = testScope("assess");
const today = new Date().toISOString().slice(0, 10);

let admin: TestUser;
let judge: TestUser;
let bootcampId: string;

/** A current bootcamp candidate on `track`, or no track at all. */
async function candidate(key: string, track: EmployeeTrack | null) {
  const id = `${TEST_PREFIX}${key}`;
  const email = `${TEST_PREFIX}${key}@${TEST_EMAIL_DOMAIN}`;
  await db.insert(employees).values({
    id,
    email,
    fullName: `Attendee ${key}`,
    title: "Solutions Engineer",
    track,
    orgDepth: 2,
    startDate: today,
    activeEffectiveDate: today,
    raw: {},
  });
  return { id, email };
}

const input = (over: Partial<AssessmentInput> = {}): AssessmentInput => ({
  name: `${TEST_PREFIX}Demo day`,
  stage: "bootcamp",
  audience: "both",
  active: true,
  criteria: [
    { name: "Discovery", description: "Asks before telling" },
    { name: "Demo", description: "" },
  ],
  ...over,
});

async function made(over: Partial<AssessmentInput> = {}) {
  const saved = await createAssessment(admin.id, input(over));
  assert.ok(saved.ok);
  return (await getAssessment(saved.id))!;
}

const scores = (criteria: { id: string }[], ...values: number[]): SubmissionInput["scores"] =>
  criteria.map((c, i) => ({ criterionId: c.id, score: values[i]!, comment: "" }));

const submission = (over: Partial<SubmissionInput> & Pick<SubmissionInput, "scores">): SubmissionInput => ({
  positiveFeedback: "",
  constructiveFeedback: "",
  revises: null,
  ...over,
});

let sales: { id: string; email: string };
let engineer: { id: string; email: string };
let deferred: { id: string; email: string };
let undecided: { id: string; email: string };

before(async () => {
  await scope.setUp();
  await db.delete(employees).where(like(employees.id, `${TEST_PREFIX}%`));
  admin = await scope.createUser("admin", PERSONAS.evalsAdmin);
  judge = await scope.createUser("judge", PERSONAS.guestJudge);
  bootcampId = await scope.activeBootcamp(admin.id);
  sales = await candidate("a_sales", "sales");
  engineer = await candidate("a_engineer", "engineer");
  deferred = await candidate("a_deferred", "deferred");
  undecided = await candidate("a_undecided", null);
});

after(async () => {
  await db.delete(employees).where(like(employees.id, `${TEST_PREFIX}%`));
  await scope.tearDown();
});

describe("assessments", () => {
  test("the list counts each one's criteria and submissions", async () => {
    const a = await made();
    const page = await listAssessments({ ...ASSESSMENT_LIST, q: TEST_PREFIX, page: 1 });
    const row = page.rows.find((r) => r.id === a.id);
    assert.equal(row?.criteria, 2);
    assert.equal(row?.submissions, 0);
  });

  test("renaming and reordering criteria keeps their ids; one left out unscored is deleted", async () => {
    const a = await made();
    const [discovery, demo] = a.criteria;
    const saved = await updateAssessment(a.id, {
      ...input(),
      criteria: [
        { id: demo!.id, name: "Demo, renamed", description: "" },
        { id: undefined, name: "Close", description: "" },
      ],
    });
    assert.ok(saved.ok);
    const after = (await getAssessment(a.id))!;
    assert.deepEqual(after.criteria.map((c) => c.name), ["Demo, renamed", "Close"]);
    assert.equal(after.criteria[0]!.id, demo!.id);
    const gone = await db.select().from(evalsAssessmentCriteria).where(eq(evalsAssessmentCriteria.id, discovery!.id));
    assert.deepEqual(gone, []);
  });

  test("an id from another assessment is refused", async () => {
    const a = await made();
    const b = await made();
    const saved = await updateAssessment(a.id, {
      ...input(),
      criteria: [{ id: b.criteria[0]!.id, name: "Stolen", description: "" }],
    });
    assert.deepEqual(saved, { ok: false, error: "invalid" });
  });
});

describe("attendees", () => {
  test("are the candidates on the tracks the audience takes in, never deferred or undecided", async () => {
    for (const [audience, want] of [
      ["sales", [sales.email]],
      ["engineer", [engineer.email]],
      ["both", [engineer.email, sales.email].sort()],
    ] as const) {
      const a = await made({ audience });
      const page = await listAttendees(a, bootcampId, { ...ASSESSMENT_ATTENDEE_LIST, q: TEST_PREFIX, page: 1 });
      assert.deepEqual(page.rows.map((r) => r.email).sort(), [...want], audience);
    }
    const both = (await scoringAssessment((await made()).id))!;
    for (const out of [deferred, undecided]) {
      assert.equal(await getScoringForm(both.id, out.id, bootcampId), null);
    }
  });

  test("an inactive assessment cannot be scored", async () => {
    const a = await made({ active: false });
    assert.equal(await scoringAssessment(a.id), null);
    const saved = await saveSubmission(judge.id, a.id, sales.id, submission({ scores: scores(a.criteria, 3, 3) }));
    assert.deepEqual(saved, { ok: false, error: "not_found" });
  });
});

describe("submissions", () => {
  test("store the average to one decimal, and the whole number decides which feedback is required", async () => {
    const a = await made();
    assert.deepEqual(
      await saveSubmission(judge.id, a.id, sales.id, submission({ scores: scores(a.criteria, 1, 2) })),
      { ok: false, error: "feedback_required" },
    );
    assert.deepEqual(
      await saveSubmission(judge.id, a.id, sales.id, submission({ scores: scores(a.criteria, 3, 4) })),
      { ok: false, error: "feedback_required" },
    );
    const saved = await saveSubmission(
      judge.id,
      a.id,
      sales.id,
      submission({ scores: scores(a.criteria, 2, 3) }), // 2.5 shows as 3: neither required
    );
    assert.ok(saved.ok);
    assert.equal(saved.submission.averageScore, 2.5);
  });

  test("there is one per attendee: a revision names the version it revises, and its saver owns it", async () => {
    const a = await made();
    const first = await saveSubmission(judge.id, a.id, engineer.id, submission({ scores: scores(a.criteria, 3, 3) }));
    assert.ok(first.ok);

    // A second first save, or a revision of a stale version, is a conflict.
    assert.deepEqual(
      await saveSubmission(admin.id, a.id, engineer.id, submission({ scores: scores(a.criteria, 3, 3) })),
      { ok: false, error: "conflict" },
    );
    const revises = first.submission.updatedAt.toISOString();
    const revised = await saveSubmission(
      admin.id,
      a.id,
      engineer.id,
      submission({ scores: scores(a.criteria, 4, 4), positiveFeedback: "Outstanding", revises }),
    );
    assert.ok(revised.ok);
    assert.equal(revised.submission.id, first.submission.id);
    assert.deepEqual(
      await saveSubmission(judge.id, a.id, engineer.id, submission({ scores: scores(a.criteria, 3, 3), revises })),
      { ok: false, error: "conflict" },
    );

    const form = (await getScoringForm(a.id, engineer.id, bootcampId))!;
    assert.equal(form.submission?.ownerId, admin.id);
    assert.equal(form.submission?.averageScore, 4);
    assert.equal(form.submission?.positiveFeedback, "Outstanding");
    // The scratch database may hold real employees too, so only the scored count is exact.
    const counts = await attendeeCounts(form.assessment, bootcampId);
    assert.equal(counts.scored, 1);
    assert.ok(counts.attendees >= 2);
  });

  test("once scored, stage and audience lock, a dropped criterion retires, and the assessment stays", async () => {
    const a = await made();
    const saved = await saveSubmission(judge.id, a.id, sales.id, submission({ scores: scores(a.criteria, 3, 3) }));
    assert.ok(saved.ok);

    assert.deepEqual(await updateAssessment(a.id, { ...input(), audience: "sales" }), { ok: false, error: "locked" });
    assert.deepEqual(await deleteAssessment(a.id), { ok: false, error: "has_scores" });

    const [discovery, demo] = a.criteria;
    assert.ok(
      (
        await updateAssessment(a.id, {
          ...input({ name: `${TEST_PREFIX}Renamed` }),
          criteria: [
            { id: demo!.id, name: "Demo", description: "" },
            { name: "Close", description: "" },
          ],
        })
      ).ok,
    );
    const [retired] = await db.select().from(evalsAssessmentCriteria).where(eq(evalsAssessmentCriteria.id, discovery!.id));
    assert.ok(retired?.retiredAt, "the scored criterion is kept, retired");

    // The new criterion has no score, so the attendee needs rescoring.
    const page = await listAttendees(a, bootcampId, { ...ASSESSMENT_ATTENDEE_LIST, q: sales.email, page: 1 });
    assert.equal(page.rows[0]?.needsRescoring, true);

    // Rescoring drops the retired criterion's score and clears the flag.
    const now = (await getAssessment(a.id))!;
    const form = (await getScoringForm(a.id, sales.id, bootcampId))!;
    const rescored = await saveSubmission(
      admin.id,
      a.id,
      sales.id,
      submission({ scores: scores(now.criteria, 3, 3), revises: form.submission!.updatedAt.toISOString() }),
    );
    assert.ok(rescored.ok);
    const after = (await getScoringForm(a.id, sales.id, bootcampId))!;
    assert.deepEqual(Object.keys(after.submission!.scores).sort(), now.criteria.map((c) => c.id).sort());
    const again = await listAttendees(a, bootcampId, { ...ASSESSMENT_ATTENDEE_LIST, q: sales.email, page: 1 });
    assert.equal(again.rows[0]?.needsRescoring, false);
  });
});

describe("the Current tab's score columns", () => {
  test("are the stage's active assessments for the track, with each score at the active bootcamp and their mean", async () => {
    const forSales = await made({ name: `${TEST_PREFIX}Cohort A`, audience: "sales" });
    const forBoth = await made({ name: `${TEST_PREFIX}Cohort B`, audience: "both" });
    const forEngineers = await made({ name: `${TEST_PREFIX}Cohort C`, audience: "engineer" });
    const intermediate = await made({ name: `${TEST_PREFIX}Cohort D`, stage: "intermediate", audience: "sales" });
    const inactive = await made({ name: `${TEST_PREFIX}Cohort E`, audience: "sales", active: false });
    const ours = new Set([forSales, forBoth, forEngineers, intermediate, inactive].map((a) => a.id));

    // The scratch database may hold other suites' assessments; only ours are asserted on.
    const columns = async (filter: Parameters<typeof cohortScoring>[0]) => {
      const scoring = await cohortScoring(filter);
      return scoring && { ...scoring, assessments: scoring.assessments.filter((a) => ours.has(a.id)).map((a) => a.name) };
    };
    assert.deepEqual(await columns({ stage: "bootcamp", track: "sales" }), {
      bootcampId,
      assessments: [`${TEST_PREFIX}Cohort A`, `${TEST_PREFIX}Cohort B`],
    });
    assert.deepEqual((await columns({ stage: "bootcamp", track: "engineer" }))?.assessments, [
      `${TEST_PREFIX}Cohort B`,
      `${TEST_PREFIX}Cohort C`,
    ]);
    for (const filter of [
      { stage: "bootcamp", track: null },
      { stage: "bootcamp", track: "undecided" },
      { stage: "bootcamp", track: "deferred" },
      { stage: null, track: "sales" },
    ] as const) {
      assert.equal(await cohortScoring(filter), null, JSON.stringify(filter));
    }

    for (const [a, values] of [
      [forSales, [3, 3]],
      [forBoth, [2, 3]],
    ] as const) {
      const saved = await saveSubmission(judge.id, a.id, sales.id, submission({ scores: scores(a.criteria, ...values) }));
      assert.ok(saved.ok);
    }

    const filter = { stage: "bootcamp", track: "sales" } as const;
    // Earlier tests scored the same person on assessments of their own, so the columns are narrowed to ours.
    const all = (await cohortScoring(filter))!;
    const scoring = { ...all, assessments: all.assessments.filter((x) => ours.has(x.id)) };
    const query = { ...CURRENT_COHORT_LIST, q: TEST_PREFIX, page: 1, sort: "email" as const, dir: "asc" as const };
    const row = async (evals?: Parameters<typeof listCurrentCohort>[2]) =>
      (await listCurrentCohort(filter, query, evals)).rows.find((m) => m.email === sales.email)!;

    // 3.0 and 2.5 average 2.75, which rounds up.
    const scored = await row({ scoring });
    assert.deepEqual(scored.scores, { [forSales.id]: 3, [forBoth.id]: 2.5 });
    assert.equal(scored.averageScore, 2.8);

    // Outside eVals, no scores at all.
    const hidden = await row();
    assert.deepEqual(hidden.scores, {});
    assert.equal(hidden.averageScore, null);
    assert.equal(hidden.btcScore, null);
  });
});

describe("tags in a criterion's comment", () => {
  const tagsIn = async (viewer: TestUser, access = viewer.access, assessmentId?: string) =>
    (await listMyMentions({ email: viewer.email, access }, { ...MY_MENTION_LIST, q: TEST_PREFIX, page: 1 })).rows.filter(
      (r) => r.kind === "score" && r.assessmentId === assessmentId,
    );

  test("reach the inbox of whoever is tagged, and a revision keeps the ones still given", async () => {
    const a = await made();
    const [discovery, demo] = a.criteria;
    const tagged = (people: TestUser[]): SubmissionInput["scores"] => [
      { criterionId: discovery!.id, score: 3, comment: "Ask @them", mentions: people.map((p) => p.email) },
      { criterionId: demo!.id, score: 3, comment: "" },
    ];

    const first = await saveSubmission(judge.id, a.id, engineer.id, submission({ scores: tagged([admin, judge]) }));
    assert.ok(first.ok);
    const form = (await getScoringForm(a.id, engineer.id, bootcampId))!;
    assert.deepEqual(form.submission!.scores[discovery!.id]!.mentions.map((m) => m.email).sort(), [admin.email, judge.email].sort());
    assert.deepEqual(form.submission!.scores[demo!.id]!.mentions, []);
    assert.ok(form.people.some((p) => p.email === judge.email), "a guest judge of the bootcamp can be tagged");

    const [mine] = await tagsIn(admin, admin.access, a.id);
    assert.equal(mine?.text, "Ask @them");
    assert.equal(mine?.criterionName, discovery!.name);
    assert.equal(mine?.employeeId, engineer.id);
    // A guest judge sees theirs while they judge the bootcamp; someone tagged who has since left eVals does not.
    assert.equal((await tagsIn(judge, judge.access, a.id)).length, 1);
    assert.deepEqual(await tagsIn(admin, PERSONAS.nobody, a.id), []);

    const revised = await saveSubmission(
      admin.id,
      a.id,
      engineer.id,
      submission({ scores: tagged([admin]), revises: first.submission.updatedAt.toISOString() }),
    );
    assert.ok(revised.ok);
    const [kept] = await tagsIn(admin, admin.access, a.id);
    assert.equal(kept?.mentionId, mine?.mentionId, "the tag still given is the same one");
    assert.equal(kept?.taggedByEmail, judge.email.toLowerCase(), "and is still from whoever made it");
    assert.deepEqual(await tagsIn(judge, judge.access, a.id), []);
  });

  test("cannot name someone who can neither use eVals nor judge the bootcamp", async () => {
    const a = await made();
    const stranger = await scope.createUser("stranger", PERSONAS.nobody);
    const saved = await saveSubmission(
      judge.id,
      a.id,
      sales.id,
      submission({
        scores: a.criteria.map((c) => ({ criterionId: c.id, score: 3, comment: "", mentions: [stranger.email] })),
      }),
    );
    assert.deepEqual(saved, { ok: false, error: "not_scorer", email: stranger.email.toLowerCase() });
  });
});
