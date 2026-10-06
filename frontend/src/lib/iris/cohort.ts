/**
 * What Iris administrators see: everyone's placements, one person's
 * question-by-question path with the answers they chose, and clearing a
 * person's results so they can sit the subjects again. Previews are never
 * reported.
 */

import "server-only";
import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { irisAttempts, irisResponses, irisTakers, users } from "@/db/schema";
import { IDK, type Confidence, type Form, type Level, type Phase } from "@/lib/iris/engine";
import { ITEMS_BY_ID } from "@/lib/iris/reviews";
import { SUBJECT_KEYS, compositeOf, isSubjectKey, type SubjectKey, type Track } from "@/lib/iris/subjects";
import type { IrisCohortSort } from "@/lib/list-specs";
import { pageWindow, toPage, type ListQuery, type Page } from "@/lib/paging";
import { orderFor, searchAny } from "@/lib/paging-sql";

export type CohortRow = {
  userId: string;
  name: string | null;
  email: string | null;
  track: Track | null;
  placements: Partial<Record<SubjectKey, Level>>;
  completed: number;
  composite: number | null;
  finishedAt: Date;
};

const person = sql`lower(coalesce(nullif(${users.name}, ''), ${users.email}))`;
const completed = sql<number>`count(*)::int`;
const lastFinished = sql<Date>`max(${irisAttempts.finishedAt})`;

const COHORT_SORT_COLUMNS = {
  finishedAt: lastFinished,
  person,
  track: irisTakers.track,
  completed,
} as const;

/** One page of everyone with a finished live sitting on `form`, searched by name or email. */
export async function listCohort(query: ListQuery<IrisCohortSort>, form: Form): Promise<Page<CohortRow>> {
  const { limit, offset } = pageWindow(query.page);
  const rows = await db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      track: irisTakers.track,
      completed,
      finishedAt: lastFinished,
      placements: sql<Record<string, number>>`json_object_agg(${irisAttempts.subject}, ${irisAttempts.placement})`,
    })
    .from(irisAttempts)
    .innerJoin(users, eq(users.id, irisAttempts.userId))
    .leftJoin(irisTakers, eq(irisTakers.userId, users.id))
    .where(
      and(
        eq(irisAttempts.mode, "live"),
        eq(irisAttempts.form, form),
        isNotNull(irisAttempts.finishedAt),
        searchAny(query.q, [users.name, users.email]),
      ),
    )
    .groupBy(users.id, irisTakers.track)
    .orderBy(...orderFor(COHORT_SORT_COLUMNS[query.sort], query.dir, users.email, users.id))
    .limit(limit)
    .offset(offset);

  return toPage(
    rows.map((r) => {
      const placements = placementsOf(r.placements);
      const track = (r.track as Track | null) ?? null;
      return {
        userId: r.userId,
        name: r.name,
        email: r.email,
        track,
        placements,
        completed: r.completed,
        composite: track ? compositeOf(placements, track) : null,
        finishedAt: new Date(r.finishedAt),
      };
    }),
    query.page,
  );
}

function placementsOf(raw: Record<string, number> | null): Partial<Record<SubjectKey, Level>> {
  const out: Partial<Record<SubjectKey, Level>> = {};
  for (const [k, v] of Object.entries(raw ?? {})) if (isSubjectKey(k) && v) out[k] = v as Level;
  return out;
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
    .select({ name: users.name, email: users.email, track: irisTakers.track })
    .from(users)
    .leftJoin(irisTakers, eq(irisTakers.userId, users.id))
    .where(eq(users.id, userId));
  if (!who) return null;

  const attempts = await db
    .select()
    .from(irisAttempts)
    .where(and(eq(irisAttempts.userId, userId), eq(irisAttempts.form, form), eq(irisAttempts.mode, "live")));

  const sittings: DetailSitting[] = [];
  // One query per sitting keeps each to at most 17 rows.
  for (const a of attempts) {
    const responses = await db
      .select()
      .from(irisResponses)
      .where(eq(irisResponses.attemptId, a.id))
      .orderBy(asc(irisResponses.seq));
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
export async function clearResults(userId: string): Promise<{ ok: true; deleted: number; email: string | null } | { ok: false; error: "not_found" }> {
  const [who] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId));
  if (!who) return { ok: false, error: "not_found" };
  const gone = await db.delete(irisAttempts).where(eq(irisAttempts.userId, userId)).returning({ id: irisAttempts.id });
  return { ok: true, deleted: gone.length, email: who.email };
}
