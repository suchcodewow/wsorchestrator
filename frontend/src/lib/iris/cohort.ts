/**
 * What Assessments Administrators see beside the Participants table
 * (`participants.ts`): how the Participants placed as a whole, one person's
 * question-by-question path with the answers they chose, and clearing a
 * person's results so they can sit the subjects again. Previews are never
 * reported.
 */

import "server-only";
import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { irisAttempts, irisParticipants, irisResponses, irisTakers, users } from "@/db/schema";
import { IDK, type Confidence, type Form, type Level, type Phase } from "@/lib/iris/engine";
import { participantEmails } from "@/lib/iris/participants";
import { ITEMS_BY_ID } from "@/lib/iris/reviews";
import { SUBJECT_KEYS, compositeOf, isSubjectKey, type SubjectKey, type Track } from "@/lib/iris/subjects";
import { searchAny } from "@/lib/paging-sql";

export type SubjectSummary = {
  /** The middle placement of everyone who finished it; null when nobody has. */
  median: Level | null;
  placed: number;
  /** How many placed at each level. */
  levels: Record<Level, number>;
};

export type CohortSummary = {
  people: number;
  subjects: Record<SubjectKey, SubjectSummary>;
  /** The subjects with the lowest median, where the cohort as a whole is weakest. */
  weakest: SubjectKey[];
};

/**
 * How the Participants on `form` placed in each subject, everyone the search
 * `q` matches rather than one page of them: one row per subject, at most eight.
 */
export async function cohortSummary(form: Form, q = ""): Promise<CohortSummary> {
  const scope = and(
    eq(irisAttempts.mode, "live"),
    eq(irisAttempts.form, form),
    isNotNull(irisAttempts.finishedAt),
    sql`lower(${users.email}) in (${await participantEmails()})`,
    searchAny(q, [users.name, users.email]),
  );
  const rows = await db
    .select({
      subject: irisAttempts.subject,
      median: sql<number | null>`percentile_disc(0.5) within group (order by ${irisAttempts.placement})`,
      placed: sql<number>`count(*)::int`,
      beginner: sql<number>`count(*) filter (where ${irisAttempts.placement} = 1)::int`,
      intermediate: sql<number>`count(*) filter (where ${irisAttempts.placement} = 2)::int`,
      advanced: sql<number>`count(*) filter (where ${irisAttempts.placement} = 3)::int`,
    })
    .from(irisAttempts)
    .innerJoin(users, eq(users.id, irisAttempts.userId))
    .where(scope)
    .groupBy(irisAttempts.subject);
  const [{ people } = { people: 0 }] = await db
    .select({ people: sql<number>`count(distinct ${irisAttempts.userId})::int` })
    .from(irisAttempts)
    .innerJoin(users, eq(users.id, irisAttempts.userId))
    .where(scope);

  const subjects = Object.fromEntries(SUBJECT_KEYS.map((k) => [k, { median: null, placed: 0, levels: { 1: 0, 2: 0, 3: 0 } }])) as Record<
    SubjectKey,
    SubjectSummary
  >;
  for (const r of rows) {
    if (!isSubjectKey(r.subject)) continue;
    subjects[r.subject] = {
      median: r.median === null ? null : (Number(r.median) as Level),
      placed: r.placed,
      levels: { 1: r.beginner, 2: r.intermediate, 3: r.advanced },
    };
  }
  const medians = SUBJECT_KEYS.map((k) => subjects[k].median).filter((m): m is Level => m !== null);
  const lowest = medians.length ? Math.min(...medians) : null;
  return {
    people,
    subjects,
    weakest: lowest === null ? [] : SUBJECT_KEYS.filter((k) => subjects[k].median === lowest),
  };
}

export type DetailAnswer = {
  seq: number;
  itemId: string;
  itemVersion: string;
  level: Level;
  phase: Phase;
  stem: string | null;
  /** The option they chose, null for "I don't know". */
  chosen: { index: number; text: string | null } | null;
  correct: boolean;
  ms: number;
};

export type DetailSitting = {
  subject: SubjectKey;
  placement: Level | null;
  confidence: Confidence | null;
  questions: number;
  startedAt: Date;
  finishedAt: Date | null;
  answers: DetailAnswer[];
};

export type PersonDetail = {
  userId: string;
  name: string | null;
  email: string | null;
  track: Track | null;
  form: Form;
  composite: number | null;
  sittings: DetailSitting[];
};

/** One person's live sittings on `form`, finished or not, each with every answer in order. */
export async function personDetail(userId: string, form: Form): Promise<PersonDetail | null> {
  const [who] = await db
    .select({ name: users.name, email: users.email, track: sql<string | null>`coalesce(${irisTakers.track}, ${irisParticipants.track})` })
    .from(users)
    .leftJoin(irisTakers, eq(irisTakers.userId, users.id))
    .leftJoin(irisParticipants, eq(irisParticipants.email, sql`lower(${users.email})`))
    .where(eq(users.id, userId));
  if (!who) return null;

  const attempts = await db
    .select()
    .from(irisAttempts)
    .where(and(eq(irisAttempts.userId, userId), eq(irisAttempts.form, form), eq(irisAttempts.mode, "live")));

  const sittings: DetailSitting[] = [];
  // One query per sitting keeps each to at most 17 rows.
  // A sitting on a subject that is no longer offered is left out rather than shown nameless.
  for (const a of attempts.filter((a) => isSubjectKey(a.subject))) {
    const responses = await db.select().from(irisResponses).where(eq(irisResponses.attemptId, a.id)).orderBy(asc(irisResponses.seq));
    sittings.push({
      subject: a.subject as SubjectKey,
      placement: (a.placement as Level | null) ?? null,
      confidence: (a.confidence as Confidence | null) ?? null,
      questions: a.questions,
      startedAt: a.startedAt,
      finishedAt: a.finishedAt,
      answers: responses.map((r) => {
        const item = ITEMS_BY_ID.get(r.itemId);
        const current = item?.version === r.itemVersion ? item : undefined;
        return {
          seq: r.seq,
          itemId: r.itemId,
          itemVersion: r.itemVersion,
          level: r.level as Level,
          phase: r.phase as Phase,
          stem: current?.stem ?? null,
          chosen: r.choice === IDK ? null : { index: r.choice, text: current?.options[r.choice] ?? null },
          correct: r.correct,
          ms: r.ms,
        };
      }),
    });
  }
  sittings.sort((x, y) => SUBJECT_KEYS.indexOf(x.subject) - SUBJECT_KEYS.indexOf(y.subject));

  const placements: Partial<Record<SubjectKey, Level>> = {};
  for (const s of sittings) if (s.placement && s.finishedAt) placements[s.subject] = s.placement;
  const track = (who.track as Track | null) ?? null;
  return {
    userId,
    name: who.name,
    email: who.email,
    track,
    form,
    composite: track ? compositeOf(placements, track) : null,
    sittings,
  };
}

/** Deletes every sitting `userId` has, on every form and in progress or not, so they can start over. */
export async function clearResults(
  userId: string,
): Promise<{ ok: true; deleted: number; email: string | null } | { ok: false; error: "not_found" }> {
  const [who] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId));
  if (!who) return { ok: false, error: "not_found" };
  const gone = await db.delete(irisAttempts).where(eq(irisAttempts.userId, userId)).returning({ id: irisAttempts.id });
  return { ok: true, deleted: gone.length, email: who.email };
}

/**
 * Deletes `userId`'s live sitting of one subject on `form`, finished or not,
 * with its answers, so they can take that subject again. Their other subjects
 * are left alone. `deleted` is 0 when there was nothing to reset.
 */
export async function resetSitting(
  userId: string,
  subject: SubjectKey,
  form: Form,
): Promise<{ ok: true; deleted: number; email: string | null } | { ok: false; error: "not_found" }> {
  const [who] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId));
  if (!who) return { ok: false, error: "not_found" };
  const gone = await db
    .delete(irisAttempts)
    .where(
      and(eq(irisAttempts.userId, userId), eq(irisAttempts.subject, subject), eq(irisAttempts.form, form), eq(irisAttempts.mode, "live")),
    )
    .returning({ id: irisAttempts.id });
  return { ok: true, deleted: gone.length, email: who.email };
}
