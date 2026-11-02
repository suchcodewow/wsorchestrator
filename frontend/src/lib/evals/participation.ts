/**
 * Participation: the marks judges give attendees at the active bootcamp, the
 * descriptors they mark, and the built-in Participation assessment generated
 * from them.
 *
 * A mark is a shared counter from 0 to `PARTICIPATION_LIMITS.maxCount`, with
 * every click logged, so two judges clicking at once both count and the popup
 * can say who did what. An attendee's first mark creates their assessment,
 * because a mark shows they are attending, with a blank score that no average
 * counts. Generate fills that in, and from then on it counts towards the class
 * like any other assessment. If their marks all go back to zero before then,
 * the assessment goes too, so that a mistaken click never counts as attendance.
 */

import "server-only";

import { and, asc, eq, inArray, isNotNull, isNull, lt, gt, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  EVALS_SETTINGS_KEYS,
  PARTICIPATION_LIMITS,
  PARTICIPATION_POLARITIES,
  employees,
  evalsAssessments,
  evalsSettings,
  evalsSubmissions,
  participationDescriptors,
  participationMarkEvents,
  participationMarks,
  scheduleSessionGroups,
  scheduleSessions,
  type EvalsAssessmentStage,
  type ParticipationPolarity,
} from "@/db/schema";
import { attended } from "@/lib/evals/attendance";
import { IN_STAGE, isCandidate } from "@/lib/evals/current-cohort";
import { writeFeedback, type FeedbackPerson, type WrittenFeedback } from "@/lib/evals/participation-feedback";
import {
  DEFAULT_PARTICIPATION_BANDS,
  bandsInOrder,
  generationCounts,
  participationScore,
  planGeneration,
  type GenerationPlan,
  type NamedMark,
  type ParticipationBands,
} from "@/lib/evals/participation-values";
import { getCandidateCutoffs } from "@/lib/evals/settings";
import { reviewConfigured } from "@/lib/evals/transcript-review";
import { taggerOf } from "@/lib/mention-store";
import { cohortBootcamp } from "@/lib/reporting/bootcamp";
import { activeBootcamp, type ActiveBootcamp } from "@/lib/scheduler/bootcamps";

const d = participationDescriptors;
const m = participationMarks;
const s = evalsSubmissions;

export type ParticipationDescriptorRow = { id: string; name: string; polarity: ParticipationPolarity };

/** The descriptors on the list, positive first, in the order set in eVals Settings. */
export async function activeDescriptors(): Promise<ParticipationDescriptorRow[]> {
  return db
    .select({ id: d.id, name: d.name, polarity: d.polarity })
    .from(d)
    .where(isNull(d.retiredAt))
    .orderBy(sql`case when ${d.polarity} = 'positive' then 0 else 1 end`, asc(d.position), asc(d.createdAt))
    .limit(PARTICIPATION_LIMITS.descriptors);
}

const bandsSchema = z
  .object({
    four: z.number().int().min(-100).max(100),
    three: z.number().int().min(-100).max(100),
    two: z.number().int().min(-100).max(100),
  })
  .refine(bandsInOrder);

/** The bands set in eVals Settings, or the defaults when none are, or what is stored cannot be read. */
export async function participationBands(): Promise<ParticipationBands> {
  const [row] = await db
    .select({ value: evalsSettings.value })
    .from(evalsSettings)
    .where(eq(evalsSettings.key, EVALS_SETTINGS_KEYS.participationBands));
  if (!row) return DEFAULT_PARTICIPATION_BANDS;
  try {
    return bandsSchema.parse(JSON.parse(row.value));
  } catch {
    return DEFAULT_PARTICIPATION_BANDS;
  }
}

export type ParticipationSettings = { descriptors: ParticipationDescriptorRow[]; bands: ParticipationBands };

export async function participationSettings(): Promise<ParticipationSettings> {
  const [descriptors, bands] = await Promise.all([activeDescriptors(), participationBands()]);
  return { descriptors, bands };
}

export const participationSettingsSchema = z.object({
  /** In the order they show. An `id` keeps an existing descriptor; without one it is new; one left out is retired. */
  descriptors: z
    .array(
      z.object({
        id: z.string().uuid().optional(),
        name: z.string().trim().min(1).max(PARTICIPATION_LIMITS.name),
        polarity: z.enum(PARTICIPATION_POLARITIES),
      }),
    )
    .max(PARTICIPATION_LIMITS.descriptors),
  bands: bandsSchema,
});

export type ParticipationSettingsInput = z.infer<typeof participationSettingsSchema>;

export type SettingsError = "duplicate" | "not_found";

export const SETTINGS_STATUS_FOR: Record<SettingsError, number> = { duplicate: 409, not_found: 404 };

export async function saveParticipationSettings(
  actorId: string,
  input: ParticipationSettingsInput,
): Promise<{ ok: true; settings: ParticipationSettings } | { ok: false; error: SettingsError }> {
  const names = input.descriptors.map((x) => x.name.toLowerCase());
  if (new Set(names).size !== names.length) return { ok: false, error: "duplicate" };

  const result = await db.transaction(async (tx) => {
    const now = new Date();
    const current = await tx
      .select({ id: d.id })
      .from(d)
      .where(isNull(d.retiredAt))
      .limit(PARTICIPATION_LIMITS.descriptors);
    const known = new Set(current.map((x) => x.id));
    if (input.descriptors.some((x) => x.id && !known.has(x.id))) return "not_found" as const;

    const kept = new Set(input.descriptors.flatMap((x) => (x.id ? [x.id] : [])));
    const retired = current.filter((x) => !kept.has(x.id)).map((x) => x.id);
    if (retired.length > 0) await tx.update(d).set({ retiredAt: now, updatedAt: now }).where(inArray(d.id, retired));

    const position = { positive: 0, negative: 0 };
    for (const x of input.descriptors) {
      const fields = { name: x.name, polarity: x.polarity, position: position[x.polarity]++, updatedAt: now };
      if (x.id) await tx.update(d).set(fields).where(eq(d.id, x.id));
      else await tx.insert(d).values({ ...fields, createdBy: actorId });
    }

    const value = JSON.stringify(input.bands);
    await tx
      .insert(evalsSettings)
      .values({ key: EVALS_SETTINGS_KEYS.participationBands, value, updatedBy: actorId })
      .onConflictDoUpdate({ target: evalsSettings.key, set: { value, updatedBy: actorId, updatedAt: now } });
    return null;
  });
  if (result) return { ok: false, error: result };
  return { ok: true, settings: await participationSettings() };
}

export type ParticipationError = "no_bootcamp" | "not_found" | "no_class";

export const PARTICIPATION_STATUS_FOR: Record<ParticipationError, number> = {
  no_bootcamp: 409,
  no_class: 409,
  not_found: 404,
};

type Attendee = { id: string; email: string; fullName: string; title: string; stage: EvalsAssessmentStage };

/**
 * The attendee as participation sees them at the active bootcamp: a current
 * candidate on a track, or anyone assessed there, in the class Reporting
 * shows them in, so releasing their BTC this week does not move their marks.
 */
async function bootcampAttendee(
  employeeId: string,
): Promise<{ ok: true; bootcamp: ActiveBootcamp; attendee: Attendee } | { ok: false; error: ParticipationError }> {
  const bootcamp = await activeBootcamp();
  if (!bootcamp) return { ok: false, error: "no_bootcamp" };
  const cutoffs = await getCandidateCutoffs();
  const [row] = await db
    .select({
      id: employees.id,
      email: employees.email,
      fullName: employees.fullName,
      title: employees.title,
      stage: sql<EvalsAssessmentStage>`case when ${attended("bootcamp", sql`${employees.email}`, { before: bootcamp.startDate })} then 'intermediate' else 'bootcamp' end`,
      eligible: sql<boolean>`(${and(isCandidate(cutoffs), inArray(employees.track, ["sales", "engineer"]))})
        or exists (select 1 from ${s} where ${s.bootcampId} = ${bootcamp.id} and ${s.attendeeEmail} = ${employees.email})`,
    })
    .from(employees)
    .where(eq(employees.id, employeeId));
  if (!row?.eligible) return { ok: false, error: "not_found" };
  if (row.stage === "intermediate" && bootcamp.intDays === null) return { ok: false, error: "no_class" };
  const { id, email, fullName, title, stage } = row;
  return { ok: true, bootcamp, attendee: { id, email, fullName, title, stage } };
}

export type ParticipationSheet = {
  attendee: Attendee;
  descriptors: (ParticipationDescriptorRow & {
    count: number;
    /** Who moved this counter and by how much, leaving out anyone whose clicks cancelled out. */
    adjustments: { name: string; net: number }[];
  })[];
  /** What Generate would score them now; null until they have a mark. */
  runningScore: number | null;
  /** The saved assessment, for someone who may read it; its score is blank before Generate. */
  saved: { averageScore: number | null; positiveFeedback: string; constructiveFeedback: string } | null;
};

async function readSheet(
  bootcamp: ActiveBootcamp,
  attendee: Attendee,
  withSaved: boolean,
): Promise<ParticipationSheet> {
  const scope = and(eq(m.bootcampId, bootcamp.id), eq(m.stage, attendee.stage), eq(m.attendeeEmail, attendee.email));
  const e = participationMarkEvents;
  const [descriptors, marks, events, bands, saved] = await Promise.all([
    activeDescriptors(),
    db.select({ descriptorId: m.descriptorId, count: m.count }).from(m).where(scope).limit(PARTICIPATION_LIMITS.descriptors * 2),
    db
      .select({ descriptorId: e.descriptorId, name: e.actorName, net: sql<number>`sum(${e.delta})::int` })
      .from(e)
      .where(and(eq(e.bootcampId, bootcamp.id), eq(e.stage, attendee.stage), eq(e.attendeeEmail, attendee.email)))
      .groupBy(e.descriptorId, e.actorName)
      .having(sql`sum(${e.delta}) <> 0`)
      .orderBy(asc(e.actorName))
      .limit(PARTICIPATION_LIMITS.adjustments),
    participationBands(),
    withSaved ? savedParticipation(bootcamp.id, attendee.stage, attendee.email) : null,
  ]);
  const counts = new Map(marks.map((x) => [x.descriptorId, x.count]));
  const rows = descriptors.map((x) => ({
    ...x,
    count: counts.get(x.id) ?? 0,
    adjustments: events.filter((a) => a.descriptorId === x.id).map(({ name, net }) => ({ name, net })),
  }));
  return {
    attendee,
    descriptors: rows,
    runningScore: rows.some((x) => x.count > 0) ? participationScore(rows, bands) : null,
    saved: saved ?? null,
  };
}

async function savedParticipation(bootcampId: string, stage: EvalsAssessmentStage, email: string) {
  const assessment = await participationAssessment(stage);
  if (!assessment) return null;
  const [row] = await db
    .select({ averageScore: s.averageScore, positiveFeedback: s.positiveFeedback, constructiveFeedback: s.constructiveFeedback })
    .from(s)
    .where(and(eq(s.bootcampId, bootcampId), eq(s.assessmentId, assessment.id), eq(s.attendeeEmail, email)));
  return row ?? null;
}

export async function getParticipationSheet(
  employeeId: string,
  withSaved: boolean,
): Promise<{ ok: true; sheet: ParticipationSheet } | { ok: false; error: ParticipationError }> {
  const found = await bootcampAttendee(employeeId);
  if (!found.ok) return found;
  return { ok: true, sheet: await readSheet(found.bootcamp, found.attendee, withSaved) };
}

export const adjustSchema = z.object({
  descriptorId: z.string().uuid(),
  delta: z.union([z.literal(1), z.literal(-1)]),
  /** An administrator's edit in the Administration View, which carries through to a saved score. */
  updateScore: z.boolean().optional(),
});

/**
 * Moves one counter by one. A counter already at the end it was pushed
 * towards stays there and logs nothing, which also covers two judges racing
 * for the last step.
 */
export async function adjustMark(
  actorId: string,
  employeeId: string,
  input: z.infer<typeof adjustSchema>,
  withSaved: boolean,
): Promise<{ ok: true; sheet: ParticipationSheet; descriptor: string; moved: boolean } | { ok: false; error: ParticipationError }> {
  const found = await bootcampAttendee(employeeId);
  if (!found.ok) return found;
  const { bootcamp, attendee } = found;
  const [descriptor] = await db
    .select({ name: d.name })
    .from(d)
    .where(and(eq(d.id, input.descriptorId), isNull(d.retiredAt)));
  if (!descriptor) return { ok: false, error: "not_found" };
  const { taggedByName, taggedByEmail } = await taggerOf(actorId);
  const [assessment, bands] = await Promise.all([participationAssessment(attendee.stage), participationBands()]);

  const key = { bootcampId: bootcamp.id, stage: attendee.stage, attendeeEmail: attendee.email, descriptorId: input.descriptorId };
  const moved = await db.transaction(async (tx) => {
    await tx.insert(m).values(key).onConflictDoNothing();
    const [row] = await tx
      .update(m)
      .set({ count: sql`${m.count} + ${input.delta}`, updatedAt: new Date() })
      .where(
        and(
          eq(m.bootcampId, key.bootcampId),
          eq(m.stage, key.stage),
          eq(m.attendeeEmail, key.attendeeEmail),
          eq(m.descriptorId, key.descriptorId),
          input.delta > 0 ? lt(m.count, PARTICIPATION_LIMITS.maxCount) : gt(m.count, 0),
        ),
      )
      .returning({ count: m.count });
    if (!row) return false;
    await tx
      .insert(participationMarkEvents)
      .values({ ...key, delta: input.delta, actorId, actorName: taggedByName || taggedByEmail || "Someone" });
    if (!assessment) return true;

    const ofAttendee = and(eq(s.bootcampId, bootcamp.id), eq(s.assessmentId, assessment.id), eq(s.attendeeEmail, attendee.email));
    if (input.delta > 0) {
      await tx
        .insert(s)
        .values({
          bootcampId: bootcamp.id,
          assessmentId: assessment.id,
          attendeeEmail: attendee.email,
          assessmentName: assessment.name,
          ownerId: actorId,
        })
        .onConflictDoNothing();
    }
    const remaining = await tx
      .select({ polarity: d.polarity, count: m.count })
      .from(m)
      .innerJoin(d, eq(d.id, m.descriptorId))
      .where(
        and(
          eq(m.bootcampId, key.bootcampId),
          eq(m.stage, key.stage),
          eq(m.attendeeEmail, key.attendeeEmail),
          gt(m.count, 0),
          isNull(d.retiredAt),
        ),
      )
      .limit(PARTICIPATION_LIMITS.descriptors);
    if (remaining.length === 0) {
      await tx
        .delete(s)
        .where(and(ofAttendee, isNull(s.averageScore), eq(s.positiveFeedback, ""), eq(s.constructiveFeedback, "")));
    }
    // A blank score stays blank: only Generate gives one.
    if (input.updateScore) {
      await tx
        .update(s)
        .set({ averageScore: participationScore(remaining, bands), ownerId: actorId, updatedAt: new Date() })
        .where(and(ofAttendee, isNotNull(s.averageScore)));
    }
    return true;
  });
  return { ok: true, sheet: await readSheet(bootcamp, attendee, withSaved), descriptor: descriptor.name, moved };
}

export type GroupPerson = { id: string; fullName: string };

/**
 * Everyone evaluated with this attendee in a breakout scored on this
 * assessment: the viewer's group with them if they have one, or else the
 * group they are in with another instructor. Empty for someone in no group.
 */
export async function evaluationGroup(assessmentId: string, employeeId: string, viewerEmail: string | null): Promise<GroupPerson[]> {
  const bootcamp = await activeBootcamp();
  if (!bootcamp) return [];
  const [attendee] = await db.select({ email: employees.email }).from(employees).where(eq(employees.id, employeeId));
  if (!attendee) return [];

  const groupWith = async (instructor: string | null) => {
    const { rows } = await db.execute<GroupPerson>(sql`
      select distinct e.id, e.full_name as "fullName", lower(e.full_name) as sort
        from ${scheduleSessionGroups} mine
        join ${scheduleSessions} ss on ss.id = mine.session_id
        join ${scheduleSessionGroups} g on g.session_id = mine.session_id and g.instructor_email = mine.instructor_email
        join ${employees} e on e.email = g.email
       where mine.email = ${attendee.email} and ss.bootcamp_id = ${bootcamp.id} and ss.kind = 'breakout'
         and ss.assessment_id = ${assessmentId}
         ${instructor ? sql`and mine.instructor_email = ${instructor}` : sql``}
       order by sort
       limit 100`);
    return rows.map(({ id, fullName }) => ({ id, fullName }));
  };
  const viewers = viewerEmail ? await groupWith(viewerEmail.toLowerCase()) : [];
  return viewers.length > 0 ? viewers : groupWith(null);
}

/** The stage's built-in assessment; null only on a database whose migration has not reached it. */
async function participationAssessment(stage: EvalsAssessmentStage) {
  const [row] = await db
    .select({ id: evalsAssessments.id, name: evalsAssessments.name })
    .from(evalsAssessments)
    .where(and(eq(evalsAssessments.builtIn, "participation"), eq(evalsAssessments.stage, stage)));
  return row ?? null;
}

async function marksOf(bootcampId: string, stage: EvalsAssessmentStage, email?: string) {
  return db
    .select({ email: m.attendeeEmail, name: d.name, polarity: d.polarity, count: m.count })
    .from(m)
    .innerJoin(d, eq(d.id, m.descriptorId))
    .where(
      and(
        eq(m.bootcampId, bootcampId),
        eq(m.stage, stage),
        gt(m.count, 0),
        isNull(d.retiredAt),
        email ? eq(m.attendeeEmail, email) : undefined,
      ),
    )
    .orderBy(asc(m.attendeeEmail), asc(d.position));
}

/** Who a press of Generate touches for one class at this bootcamp, and who it leaves out. */
async function generationPlans(bootcampId: string, stage: EvalsAssessmentStage, assessmentId: string) {
  const [marks, assessed, existing, bands, cutoffs] = await Promise.all([
    marksOf(bootcampId, stage),
    db
      .selectDistinct({ email: s.attendeeEmail })
      .from(s)
      .innerJoin(evalsAssessments, eq(evalsAssessments.id, s.assessmentId))
      .where(and(eq(s.bootcampId, bootcampId), eq(evalsAssessments.stage, stage), isNull(evalsAssessments.builtIn))),
    db
      .select({
        email: s.attendeeEmail,
        averageScore: s.averageScore,
        positiveFeedback: s.positiveFeedback,
        constructiveFeedback: s.constructiveFeedback,
      })
      .from(s)
      .where(and(eq(s.bootcampId, bootcampId), eq(s.assessmentId, assessmentId))),
    participationBands(),
    getCandidateCutoffs(),
  ]);
  const byEmail = new Map<string, NamedMark[]>();
  for (const { email, ...mark } of marks) byEmail.set(email, [...(byEmail.get(email) ?? []), mark]);
  const assessedEmails = new Set(assessed.map((x) => x.email));
  const plans = planGeneration(byEmail, assessedEmails, existing, bands);

  // Nothing shows these people came, and a submission would mark them as attended at release.
  const candidates = await db
    .select({ email: employees.email, fullName: employees.fullName })
    .from(employees)
    .where(and(isCandidate(cutoffs), IN_STAGE[stage], inArray(employees.track, ["sales", "engineer"])))
    .orderBy(sql`lower(${employees.fullName})`)
    .limit(1_000);
  const skipped = candidates.filter((c) => !byEmail.has(c.email) && !assessedEmails.has(c.email)).map((c) => c.fullName);
  return { plans, skipped };
}

export type StagePending = { comments: number; scores: number; skipped: string[] };

/** What each class's Generate button would do; null for a class the bootcamp does not hold, or one already released. */
export async function pendingParticipation(): Promise<Record<EvalsAssessmentStage, StagePending | null>> {
  const bootcamp = await cohortBootcamp();
  const one = async (stage: EvalsAssessmentStage): Promise<StagePending | null> => {
    if (!bootcamp || bootcamp.released[stage]) return null;
    if (stage === "intermediate" && !bootcamp.intermediate) return null;
    const assessment = await participationAssessment(stage);
    if (!assessment) return null;
    const { plans, skipped } = await generationPlans(bootcamp.id, stage, assessment.id);
    return { ...generationCounts(plans), skipped: skipped.slice(0, 100) };
  };
  const [btc, int] = await Promise.all([one("bootcamp"), one("intermediate")]);
  return { bootcamp: btc, intermediate: int };
}

export type GenerateError = "no_bootcamp" | "no_intermediate" | "released" | "no_assessment" | "unconfigured" | "upstream";

export const GENERATE_STATUS_FOR: Record<GenerateError, number> = {
  no_bootcamp: 409,
  no_intermediate: 409,
  released: 409,
  no_assessment: 409,
  unconfigured: 503,
  upstream: 502,
};

function asPeople(plans: GenerationPlan[], scoreOf: (plan: GenerationPlan) => number): FeedbackPerson[] {
  return plans
    .filter((p) => p.writePositive || p.writeConstructive)
    .map((p, i) => ({
      id: `p${i + 1}`,
      marks: p.marks,
      score: scoreOf(p),
      writePositive: p.writePositive,
      writeConstructive: p.writeConstructive,
    }));
}

/**
 * Fills what is blank in one class's Participation assessments: a score for
 * anyone without one, and a comment on each side with marks and none yet.
 * Someone whose comments Claude did not write is left as they were, so
 * pressing it again picks them up.
 */
export async function generateParticipation(
  actorId: string,
  stage: EvalsAssessmentStage,
): Promise<
  | { ok: true; bootcamp: { id: string; startDate: string }; people: number; scores: number; comments: number; failed: number }
  | { ok: false; error: GenerateError }
> {
  const bootcamp = await cohortBootcamp();
  if (!bootcamp) return { ok: false, error: "no_bootcamp" };
  if (stage === "intermediate" && !bootcamp.intermediate) return { ok: false, error: "no_intermediate" };
  if (bootcamp.released[stage]) return { ok: false, error: "released" };
  const assessment = await participationAssessment(stage);
  if (!assessment) return { ok: false, error: "no_assessment" };

  const { plans } = await generationPlans(bootcamp.id, stage, assessment.id);
  const bands = await participationBands();
  const scoreOf = (p: GenerationPlan) => p.score ?? participationScore(p.marks, bands);
  const people = asPeople(plans, scoreOf);
  if (people.length > 0 && !reviewConfigured()) return { ok: false, error: "unconfigured" };

  const written = await writeFeedback(people);
  if (people.length > 0 && written.size === 0) return { ok: false, error: "upstream" };

  const idOf = new Map<GenerationPlan, string>();
  let next = 0;
  for (const plan of plans) if (plan.writePositive || plan.writeConstructive) idOf.set(plan, people[next++]!.id);

  const now = new Date();
  let saved = 0;
  let scores = 0;
  let comments = 0;
  for (const plan of plans) {
    const id = idOf.get(plan);
    const text: WrittenFeedback | undefined = id ? written.get(id) : { positive: "", constructive: "" };
    if (!text) continue;
    await db
      .insert(s)
      .values({
        bootcampId: bootcamp.id,
        assessmentId: assessment.id,
        attendeeEmail: plan.email,
        assessmentName: assessment.name,
        averageScore: scoreOf(plan),
        positiveFeedback: text.positive,
        constructiveFeedback: text.constructive,
        ownerId: actorId,
        submittedAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [s.bootcampId, s.assessmentId, s.attendeeEmail],
        // Only ever what is blank, even if someone typed a comment after the plan was made.
        set: {
          averageScore: sql`coalesce(${s.averageScore}, excluded.average_score)`,
          positiveFeedback: sql`case when btrim(${s.positiveFeedback}) = '' then excluded.positive_feedback else ${s.positiveFeedback} end`,
          constructiveFeedback: sql`case when btrim(${s.constructiveFeedback}) = '' then excluded.constructive_feedback else ${s.constructiveFeedback} end`,
          ownerId: actorId,
          updatedAt: now,
        },
      });
    saved += 1;
    if (plan.score !== null) scores += 1;
    comments += Number(plan.writePositive) + Number(plan.writeConstructive);
  }
  return {
    ok: true,
    bootcamp: { id: bootcamp.id, startDate: bootcamp.startDate },
    people: saved,
    scores,
    comments,
    failed: plans.length - saved,
  };
}

export type RegenerateError = ParticipationError | "no_assessment" | "no_marks" | "unconfigured" | "upstream";

export const REGENERATE_STATUS_FOR: Record<RegenerateError, number> = {
  ...PARTICIPATION_STATUS_FOR,
  no_assessment: 409,
  no_marks: 409,
  unconfigured: 503,
  upstream: 502,
};

/**
 * Replaces one attendee's participation comments and score from the marks
 * they have now, whatever was there, without waiting for the class's
 * Generate. Someone with no marks and no assessment yet is left alone, since
 * an assessment counts as attendance at release.
 */
export async function regenerateParticipation(
  actorId: string,
  employeeId: string,
): Promise<{ ok: true; sheet: ParticipationSheet; email: string } | { ok: false; error: RegenerateError }> {
  const found = await bootcampAttendee(employeeId);
  if (!found.ok) return found;
  const { bootcamp, attendee } = found;
  const assessment = await participationAssessment(attendee.stage);
  if (!assessment) return { ok: false, error: "no_assessment" };
  const saved = await savedParticipation(bootcamp.id, attendee.stage, attendee.email);

  const [rows, bands] = await Promise.all([marksOf(bootcamp.id, attendee.stage, attendee.email), participationBands()]);
  const marks: NamedMark[] = rows.map(({ name, polarity, count }) => ({ name, polarity, count }));
  if (!saved && marks.length === 0) return { ok: false, error: "no_marks" };
  const score = participationScore(marks, bands);
  const person: FeedbackPerson = {
    id: "p1",
    marks,
    score,
    writePositive: marks.some((x) => x.polarity === "positive"),
    writeConstructive: marks.some((x) => x.polarity === "negative"),
  };
  let text: WrittenFeedback = { positive: "", constructive: "" };
  if (marks.length > 0) {
    if (!reviewConfigured()) return { ok: false, error: "unconfigured" };
    const written = (await writeFeedback([person])).get(person.id);
    if (!written) return { ok: false, error: "upstream" };
    text = written;
  }
  const now = new Date();
  const written = {
    averageScore: score,
    positiveFeedback: text.positive,
    constructiveFeedback: text.constructive,
    ownerId: actorId,
    updatedAt: now,
  };
  await db
    .insert(s)
    .values({
      bootcampId: bootcamp.id,
      assessmentId: assessment.id,
      attendeeEmail: attendee.email,
      assessmentName: assessment.name,
      submittedAt: now,
      ...written,
    })
    .onConflictDoUpdate({ target: [s.bootcampId, s.assessmentId, s.attendeeEmail], set: written });
  return { ok: true, sheet: await readSheet(bootcamp, attendee, true), email: attendee.email };
}
