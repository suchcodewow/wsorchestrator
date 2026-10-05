/**
 * Scoring on the eVals page: the attendees an assessment applies to, and the
 * one submission each of them has at the active bootcamp.
 *
 * An attendee is a current candidate (see `current-cohort.ts`) in the
 * assessment's stage on a track its audience takes in; undecided and deferred
 * people are not in the training and never appear. Scoring needs an active
 * bootcamp, and an intermediate assessment needs one that holds an
 * intermediate class. Anyone may revise a submission; whoever saves it last
 * owns it, and a save names the version it revised so that two people cannot
 * silently overwrite each other.
 */

import "server-only";

import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  EVALS_ASSESSMENT_LIMITS,
  SCHEDULE_LIMITS,
  bootcampHistory,
  employees,
  evalsAssessmentCriteria,
  evalsAssessments,
  evalsSubmissionScores,
  evalsSubmissions,
  mentions,
  users,
  type EvalsAssessmentAudience,
  type EvalsAssessmentStage,
} from "@/db/schema";
import { averageScore, requiredFeedback, tracksFor, wholeScore } from "@/lib/evals/assessment-values";
import { IN_STAGE, isCandidate } from "@/lib/evals/current-cohort";
import { getCandidateCutoffs } from "@/lib/evals/settings";
import { listTranscripts, type Transcript } from "@/lib/evals/transcripts";
import type { AssessmentAttendeeSort } from "@/lib/list-specs";
import { pickMentions, scorerPool, taggerOf } from "@/lib/mention-store";
import type { MentionPick } from "@/lib/mentions";
import { pageWindow, toPage, type ListQuery, type Page } from "@/lib/paging";
import { blankAsNull, orderFor, searchAny } from "@/lib/paging-sql";
import { activeBootcamp, type ActiveBootcamp } from "@/lib/scheduler/bootcamps";

const e = employees;
const h = bootcampHistory;
const s = evalsSubmissions;

/** The bootcamp scoring happens at, if one is active and holds the stage's class. */
export async function scoringBootcamp(stage: EvalsAssessmentStage): Promise<ActiveBootcamp | null> {
  const bootcamp = await activeBootcamp();
  if (!bootcamp) return null;
  if (stage === "intermediate" && bootcamp.intDays === null) return null;
  return bootcamp;
}

export type ScoringAssessment = {
  id: string;
  name: string;
  stage: EvalsAssessmentStage;
  audience: EvalsAssessmentAudience;
};

/** An active assessment, as scoring sees it; null if it is missing or inactive. */
export async function scoringAssessment(id: string): Promise<ScoringAssessment | null> {
  const [row] = await db
    .select({
      id: evalsAssessments.id,
      name: evalsAssessments.name,
      stage: evalsAssessments.stage,
      audience: evalsAssessments.audience,
    })
    .from(evalsAssessments)
    .where(and(eq(evalsAssessments.id, id), eq(evalsAssessments.active, true)));
  return row ?? null;
}

/** The criteria an assessment still asks, in order; at most `EVALS_ASSESSMENT_LIMITS.criteria`. */
async function askedCriteria(assessmentId: string) {
  return db
    .select({
      id: evalsAssessmentCriteria.id,
      name: evalsAssessmentCriteria.name,
      description: evalsAssessmentCriteria.description,
    })
    .from(evalsAssessmentCriteria)
    .where(and(eq(evalsAssessmentCriteria.assessmentId, assessmentId), isNull(evalsAssessmentCriteria.retiredAt)))
    .orderBy(asc(evalsAssessmentCriteria.position), asc(evalsAssessmentCriteria.createdAt))
    .limit(EVALS_ASSESSMENT_LIMITS.criteria);
}

async function attendeeCondition(assessment: ScoringAssessment) {
  const cutoffs = await getCandidateCutoffs();
  return and(isCandidate(cutoffs), IN_STAGE[assessment.stage], inArray(e.track, tracksFor(assessment.audience)));
}

export type AttendeeRow = {
  id: string;
  email: string;
  fullName: string;
  title: string;
  track: "sales" | "engineer";
  /** At the active bootcamp; null if not scored there yet. */
  averageScore: number | null;
  /** Scored, but the assessment has gained a criterion since. */
  needsRescoring: boolean;
};

const SORT_COLUMNS = {
  fullName: sql`lower(${e.fullName})`,
  email: e.email,
  title: sql`lower(${blankAsNull(e.title)})`,
  track: e.track,
  averageScore: s.averageScore,
} as const;

function submissionJoin(assessmentId: string, bootcampId: string | null) {
  return and(
    eq(s.attendeeEmail, e.email),
    eq(s.assessmentId, assessmentId),
    bootcampId ? eq(s.bootcampId, bootcampId) : sql`false`,
  );
}

/** One page of the attendees an assessment applies to, with their score at the active bootcamp. */
export async function listAttendees(
  assessment: ScoringAssessment,
  bootcampId: string | null,
  query: ListQuery<AssessmentAttendeeSort>,
): Promise<Page<AttendeeRow>> {
  const { limit, offset } = pageWindow(query.page);
  const rows = await db
    .select({
      id: e.id,
      email: e.email,
      fullName: e.fullName,
      title: e.title,
      track: sql<"sales" | "engineer">`${e.track}`,
      averageScore: s.averageScore,
      needsRescoring: sql<boolean>`(${s.id} is not null and exists (
        select 1 from ${evalsAssessmentCriteria} c
        where c.assessment_id = ${assessment.id} and c.retired_at is null
          and not exists (
            select 1 from ${evalsSubmissionScores} sc
            where sc.submission_id = ${s.id} and sc.criterion_id = c.id
          )
      ))`,
    })
    .from(e)
    .leftJoin(h, sql`${h.email} = ${e.email}`)
    .leftJoin(s, submissionJoin(assessment.id, bootcampId))
    .where(and(await attendeeCondition(assessment), searchAny(query.q, [e.fullName, e.email, e.title])))
    .orderBy(...orderFor(SORT_COLUMNS[query.sort], query.dir, sql`lower(${e.fullName})`, e.id))
    .limit(limit)
    .offset(offset);
  return toPage(rows, query.page);
}

/** How many attendees an assessment applies to, and how many of them are scored at the active bootcamp. */
export async function attendeeCounts(
  assessment: ScoringAssessment,
  bootcampId: string | null,
): Promise<{ attendees: number; scored: number }> {
  const [row] = await db
    .select({ attendees: sql<number>`count(*)::int`, scored: sql<number>`count(${s.id})::int` })
    .from(e)
    .leftJoin(h, sql`${h.email} = ${e.email}`)
    .leftJoin(s, submissionJoin(assessment.id, bootcampId))
    .where(await attendeeCondition(assessment));
  return { attendees: row?.attendees ?? 0, scored: row?.scored ?? 0 };
}

export type ScoringForm = {
  assessment: ScoringAssessment;
  criteria: { id: string; name: string; description: string }[];
  attendee: { id: string; email: string; fullName: string; title: string; track: "sales" | "engineer" };
  submission: {
    id: string;
    averageScore: number;
    positiveFeedback: string;
    constructiveFeedback: string;
    ownerId: string | null;
    ownerName: string | null;
    updatedAt: Date;
    /** By criterion id; a criterion added since it was saved has none. */
    scores: Record<string, { score: number; comment: string; mentions: MentionPick[] }>;
  } | null;
  /** Whom a criterion's comment can tag: anyone in eVals, and the bootcamp's guest judges; none without a bootcamp. */
  people: MentionPick[];
  /** Of every recording made of this attendee on this assessment at the bootcamp, oldest first; none without a bootcamp. */
  transcripts: Transcript[];
};

async function eligibleAttendee(assessment: ScoringAssessment, employeeId: string) {
  const [row] = await db
    .select({
      id: e.id,
      email: e.email,
      fullName: e.fullName,
      title: e.title,
      track: sql<"sales" | "engineer">`${e.track}`,
    })
    .from(e)
    .leftJoin(h, sql`${h.email} = ${e.email}`)
    .where(and(eq(e.id, employeeId), await attendeeCondition(assessment)));
  return row ?? null;
}

/** What the scoring form opens with; null if the assessment or the attendee is not one that can be scored. */
export async function getScoringForm(
  assessmentId: string,
  employeeId: string,
  bootcampId: string | null,
): Promise<ScoringForm | null> {
  const assessment = await scoringAssessment(assessmentId);
  if (!assessment) return null;
  const [criteria, attendee, people] = await Promise.all([
    askedCriteria(assessmentId),
    eligibleAttendee(assessment, employeeId),
    bootcampId ? scorerPool(bootcampId) : Promise.resolve([]),
  ]);
  if (!attendee) return null;
  const transcripts = bootcampId
    ? await listTranscripts({ bootcampId, assessmentId, attendeeEmail: attendee.email })
    : [];

  const [submission] = bootcampId
    ? await db
        .select({
          id: s.id,
          averageScore: s.averageScore,
          positiveFeedback: s.positiveFeedback,
          constructiveFeedback: s.constructiveFeedback,
          ownerId: s.ownerId,
          ownerName: sql<string | null>`coalesce(nullif(${users.name}, ''), ${users.email})`,
          updatedAt: s.updatedAt,
        })
        .from(s)
        .leftJoin(users, eq(users.id, s.ownerId))
        .where(and(eq(s.bootcampId, bootcampId), eq(s.assessmentId, assessmentId), eq(s.attendeeEmail, attendee.email)))
    : [];
  if (!submission) return { assessment, criteria, attendee, submission: null, people, transcripts };

  const [scores, tags] = await Promise.all([
    db
      .select({ criterionId: evalsSubmissionScores.criterionId, score: evalsSubmissionScores.score, comment: evalsSubmissionScores.comment })
      .from(evalsSubmissionScores)
      .where(eq(evalsSubmissionScores.submissionId, submission.id))
      .limit(EVALS_ASSESSMENT_LIMITS.criteria * 2),
    db
      .select({ criterionId: mentions.criterionId, email: mentions.email, fullName: mentions.fullName })
      .from(mentions)
      .where(eq(mentions.submissionId, submission.id))
      .orderBy(mentions.fullName, mentions.email)
      .limit(EVALS_ASSESSMENT_LIMITS.criteria * SCHEDULE_LIMITS.mentions),
  ]);
  const tagsOf = (criterionId: string) =>
    tags.filter((t) => t.criterionId === criterionId).map((t) => ({ email: t.email, fullName: t.fullName }));
  return {
    assessment,
    criteria,
    attendee,
    submission: {
      ...submission,
      scores: Object.fromEntries(
        scores.map((sc) => [sc.criterionId, { score: sc.score, comment: sc.comment, mentions: tagsOf(sc.criterionId) }]),
      ),
    },
    people,
    transcripts,
  };
}

/**
 * Who and where a recording made on the scoring form is filed under: the
 * active assessment, the active bootcamp holding its class, and an attendee
 * it applies to.
 */
export async function scoringTarget(
  assessmentId: string,
  employeeId: string,
): Promise<
  | { ok: true; assessment: ScoringAssessment; bootcamp: ActiveBootcamp; attendee: { id: string; email: string } }
  | { ok: false; error: "not_found" | "no_bootcamp" }
> {
  const assessment = await scoringAssessment(assessmentId);
  if (!assessment) return { ok: false, error: "not_found" };
  const [bootcamp, attendee] = await Promise.all([scoringBootcamp(assessment.stage), eligibleAttendee(assessment, employeeId)]);
  if (!attendee) return { ok: false, error: "not_found" };
  if (!bootcamp) return { ok: false, error: "no_bootcamp" };
  return { ok: true, assessment, bootcamp, attendee: { id: attendee.id, email: attendee.email } };
}

const L = EVALS_ASSESSMENT_LIMITS;

export const submissionSchema = z.object({
  scores: z
    .array(
      z.object({
        criterionId: z.string().uuid(),
        score: z.number().int().min(1).max(4),
        comment: z.string().trim().max(L.comment).default(""),
        /** The emails of the people the comment tags. */
        mentions: z.array(z.string().trim().toLowerCase().max(320)).max(SCHEDULE_LIMITS.mentions).optional(),
      }),
    )
    .min(1)
    .max(L.criteria),
  positiveFeedback: z.string().trim().max(L.feedback).default(""),
  constructiveFeedback: z.string().trim().max(L.feedback).default(""),
  /** The `updatedAt` of the submission this revises, or null for the first. */
  revises: z.string().datetime({ offset: true }).nullable(),
});

export type SubmissionInput = z.infer<typeof submissionSchema>;

export type SubmissionError =
  | "invalid"
  | "not_found"
  | "no_bootcamp"
  | "feedback_required"
  | "not_scorer"
  | "conflict";

export const SUBMISSION_STATUS_FOR: Record<SubmissionError, number> = {
  invalid: 400,
  not_found: 404,
  no_bootcamp: 409,
  feedback_required: 400,
  not_scorer: 400,
  conflict: 409,
};

export type SavedSubmission = {
  id: string;
  attendeeEmail: string;
  assessmentName: string;
  averageScore: number;
  updatedAt: Date;
};

/** Saves the attendee's one submission at the active bootcamp, making `actorId` its owner. */
export async function saveSubmission(
  actorId: string,
  assessmentId: string,
  employeeId: string,
  input: SubmissionInput,
): Promise<{ ok: true; submission: SavedSubmission } | { ok: false; error: SubmissionError; email?: string }> {
  const assessment = await scoringAssessment(assessmentId);
  if (!assessment) return { ok: false, error: "not_found" };
  const bootcamp = await scoringBootcamp(assessment.stage);
  if (!bootcamp) return { ok: false, error: "no_bootcamp" };
  const [criteria, attendee] = await Promise.all([askedCriteria(assessmentId), eligibleAttendee(assessment, employeeId)]);
  if (!attendee) return { ok: false, error: "not_found" };

  // Exactly the criteria still asked, each once.
  const given = new Map(input.scores.map((sc) => [sc.criterionId, sc]));
  if (given.size !== input.scores.length || given.size !== criteria.length || criteria.some((c) => !given.has(c.id))) {
    return { ok: false, error: "invalid" };
  }

  const average = averageScore(input.scores.map((sc) => sc.score))!;
  const needed = requiredFeedback(wholeScore(average));
  if (needed === "constructive" && !input.constructiveFeedback) return { ok: false, error: "feedback_required" };
  if (needed === "positive" && !input.positiveFeedback) return { ok: false, error: "feedback_required" };

  // Whom each criterion's comment tags; only people who can score here can be.
  const tagged = new Map<string, MentionPick>();
  const wantedTags: { criterionId: string; email: string }[] = [];
  if (input.scores.some((sc) => sc.mentions?.length)) {
    const pool = await scorerPool(bootcamp.id);
    for (const sc of input.scores) {
      const picked = pickMentions(pool, sc.mentions);
      if (!picked.ok) return { ok: false, error: "not_scorer", email: picked.email };
      for (const p of picked.tagged) {
        tagged.set(p.email, p);
        wantedTags.push({ criterionId: sc.criterionId, email: p.email });
      }
    }
  }
  const tagger = await taggerOf(actorId);

  return db.transaction(async (tx) => {
    const now = new Date();
    const fields = {
      assessmentName: assessment.name,
      averageScore: average,
      positiveFeedback: input.positiveFeedback,
      constructiveFeedback: input.constructiveFeedback,
      ownerId: actorId,
      updatedAt: now,
    };

    const [current] = await tx
      .select({ id: s.id, updatedAt: s.updatedAt })
      .from(s)
      .where(and(eq(s.bootcampId, bootcamp.id), eq(s.assessmentId, assessmentId), eq(s.attendeeEmail, attendee.email)))
      .for("update");

    let id: string;
    if (current) {
      if (input.revises === null || current.updatedAt.getTime() !== Date.parse(input.revises)) {
        return { ok: false as const, error: "conflict" as const };
      }
      await tx.update(s).set(fields).where(eq(s.id, current.id));
      await tx.delete(evalsSubmissionScores).where(eq(evalsSubmissionScores.submissionId, current.id));
      id = current.id;
    } else {
      if (input.revises !== null) return { ok: false as const, error: "conflict" as const };
      const [inserted] = await tx
        .insert(s)
        .values({ ...fields, bootcampId: bootcamp.id, assessmentId, attendeeEmail: attendee.email, submittedAt: now })
        .onConflictDoNothing()
        .returning({ id: s.id });
      // Someone else saved the first one between our read and our write.
      if (!inserted) return { ok: false as const, error: "conflict" as const };
      id = inserted.id;
    }

    await tx.insert(evalsSubmissionScores).values(
      criteria.map((c) => ({
        submissionId: id,
        criterionId: c.id,
        criterionName: c.name,
        score: given.get(c.id)!.score,
        comment: given.get(c.id)!.comment,
      })),
    );

    // A tag still given keeps who made it and when; one no longer given goes.
    const key = (criterionId: string, email: string) => `${criterionId} ${email}`;
    const existing = await tx
      .select({ id: mentions.id, criterionId: mentions.criterionId, email: mentions.email })
      .from(mentions)
      .where(eq(mentions.submissionId, id))
      .limit(L.criteria * SCHEDULE_LIMITS.mentions);
    const want = new Set(wantedTags.map((w) => key(w.criterionId, w.email)));
    const have = new Set(existing.map((m) => key(m.criterionId!, m.email)));
    const gone = existing.filter((m) => !want.has(key(m.criterionId!, m.email))).map((m) => m.id);
    if (gone.length > 0) await tx.delete(mentions).where(inArray(mentions.id, gone));
    const added = wantedTags.filter((w) => !have.has(key(w.criterionId, w.email)));
    if (added.length > 0) {
      await tx.insert(mentions).values(
        added.map((w) => ({
          submissionId: id,
          criterionId: w.criterionId,
          bootcampId: bootcamp.id,
          email: w.email,
          fullName: tagged.get(w.email)!.fullName,
          ...tagger,
          createdAt: now,
        })),
      );
    }

    return {
      ok: true as const,
      submission: { id, attendeeEmail: attendee.email, assessmentName: assessment.name, averageScore: average, updatedAt: now },
    };
  });
}
