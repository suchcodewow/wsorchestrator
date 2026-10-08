/**
 * Taking an Iris test. The engine runs here, not in the browser: a taker is
 * sent one question at a time without its answer, posts their choice, and is
 * graded against the bank. A sitting in progress is stored, so leaving and
 * coming back resumes it rather than starting a fresh, rerollable run.
 *
 * Takers never see their placement. It is recorded for Assessments Administrators and
 * routes training; showing it would turn a starting point into a grade.
 */

import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { irisAttempts, irisResponses, irisTakers, type IrisAttempt } from "@/db/schema";
import {
  ENGINE,
  IDK,
  confidenceOf,
  drawItem,
  placementOf,
  submit,
  type Asked,
  type Confidence,
  type Form,
  type IrisItem,
  type Level,
  type Phase,
} from "@/lib/iris/engine";
import { ITEMS_BY_ID, approvedCounts, isLive, poolFor } from "@/lib/iris/reviews";
import { SUBJECTS, SUBJECT_KEYS, type SubjectKey, type Track } from "@/lib/iris/subjects";

/**
 * What a taker is shown of a question: its wording and options, nothing else.
 * Not even its id, which spells its level ("sdlc-l2-04"): watching that move
 * up or down would tell a taker whether their last answer was right.
 */
export type Question = { stem: string; options: readonly string[] };

export const toQuestion = (item: IrisItem): Question => ({ stem: item.stem, options: item.options });

export type SittingView = {
  attemptId: string;
  subject: SubjectKey;
  form: Form;
  mode: "live" | "preview";
  /** 1-based number of the question on screen; an answer names it, so one from a stale tab is caught. */
  number: number;
  /** How far through the most questions a sitting can take, 0–100, never past 100. */
  progress: number;
  question: Question;
};

function viewOf(attempt: IrisAttempt): SittingView {
  const item = ITEMS_BY_ID.get(attempt.currentItemId!)!;
  return {
    attemptId: attempt.id,
    subject: attempt.subject as SubjectKey,
    form: attempt.form as Form,
    mode: attempt.mode as "live" | "preview",
    number: attempt.questions + 1,
    progress: Math.min(100, Math.round((attempt.questions / ENGINE.MAX) * 100)),
    question: toQuestion(item),
  };
}

export type SubjectStatus = "available" | "in_progress" | "completed" | "unavailable";

export type MyIris = {
  track: Track | null;
  form: Form;
  subjects: {
    key: SubjectKey;
    name: string;
    blurb: string;
    status: SubjectStatus;
    /** Only for an Assessments Administrator looking at their own; a taker never gets it. */
    placement?: Level;
  }[];
  completed: number;
};

/**
 * Someone's own view: their track and where they are with each subject.
 * `withLevels` adds the placement of each finished subject, and is for Iris
 * administrators only; a taker is never told their level.
 */
export async function myIris(userId: string, form: Form = "A", withLevels = false): Promise<MyIris> {
  const [taker] = await db.select({ track: irisTakers.track }).from(irisTakers).where(eq(irisTakers.userId, userId));
  const sittings = await db
    .select({ subject: irisAttempts.subject, finishedAt: irisAttempts.finishedAt, placement: irisAttempts.placement })
    .from(irisAttempts)
    .where(and(eq(irisAttempts.userId, userId), eq(irisAttempts.form, form), eq(irisAttempts.mode, "live")));
  const bySubject = new Map(sittings.map((s) => [s.subject, s]));
  const approved = await approvedCounts(form);

  const subjects = SUBJECT_KEYS.map((key) => {
    const sitting = bySubject.get(key);
    const status: SubjectStatus = sitting
      ? sitting.finishedAt
        ? "completed"
        : "in_progress"
      : isLive(approved[key])
        ? "available"
        : "unavailable";
    const placement = withLevels && sitting?.finishedAt && sitting.placement ? (sitting.placement as Level) : undefined;
    return { key, name: SUBJECTS[key].name, blurb: SUBJECTS[key].blurb, status, ...(placement ? { placement } : {}) };
  });
  return {
    track: (taker?.track as Track | undefined) ?? null,
    form,
    subjects,
    completed: subjects.filter((s) => s.status === "completed").length,
  };
}

export async function setTrack(userId: string, track: Track): Promise<void> {
  await db
    .insert(irisTakers)
    .values({ userId, track, updatedAt: new Date() })
    .onConflictDoUpdate({ target: irisTakers.userId, set: { track, updatedAt: new Date() } });
}

/**
 * - `no_track`      — the taker has not said which track they are in.
 * - `already_taken` — a live sitting of this subject and form is finished.
 * - `not_ready`     — too few approved questions to run it.
 */
export type StartError = "no_track" | "already_taken" | "not_ready";

/** Starts a sitting, or picks up the one in progress. */
export async function startSitting(
  userId: string,
  subject: SubjectKey,
  form: Form,
  mode: "live" | "preview",
  random: () => number = Math.random,
): Promise<{ ok: true; sitting: SittingView; resumed: boolean } | { ok: false; error: StartError }> {
  const [taker] = await db.select({ track: irisTakers.track }).from(irisTakers).where(eq(irisTakers.userId, userId));
  if (!taker && mode === "live") return { ok: false, error: "no_track" };

  const [open] = await db
    .select()
    .from(irisAttempts)
    .where(
      and(
        eq(irisAttempts.userId, userId),
        eq(irisAttempts.subject, subject),
        eq(irisAttempts.form, form),
        eq(irisAttempts.mode, mode),
        isNull(irisAttempts.finishedAt),
      ),
    );
  if (open) return { ok: true, sitting: viewOf(open), resumed: true };

  if (mode === "live") {
    const [done] = await db
      .select({ id: irisAttempts.id })
      .from(irisAttempts)
      .where(
        and(
          eq(irisAttempts.userId, userId),
          eq(irisAttempts.subject, subject),
          eq(irisAttempts.form, form),
          eq(irisAttempts.mode, "live"),
        ),
      );
    if (done) return { ok: false, error: "already_taken" };
  }

  const pool = await poolFor(subject, form, mode);
  if (pool.length < ENGINE.MIN) return { ok: false, error: "not_ready" };
  const first = drawItem(pool, [], ENGINE.START, random);
  if (!first) return { ok: false, error: "not_ready" };

  const [created] = await db
    .insert(irisAttempts)
    .values({ userId, subject, form, mode, level: ENGINE.START, currentItemId: first.id, shownAt: new Date() })
    .onConflictDoNothing()
    .returning();
  // Two tabs starting the same live subject at once: the second finds the first's.
  if (!created) return startSitting(userId, subject, form, mode, random);
  return { ok: true, sitting: viewOf(created), resumed: false };
}

/** Whatever the taker has open on `attemptId`, for a page reload. */
export async function openSitting(userId: string, attemptId: string): Promise<SittingView | null> {
  const [attempt] = await db
    .select()
    .from(irisAttempts)
    .where(and(eq(irisAttempts.id, attemptId), eq(irisAttempts.userId, userId)));
  return attempt && !attempt.finishedAt ? viewOf(attempt) : null;
}

/**
 * - `not_found` — no such sitting of theirs.
 * - `finished`  — it is over.
 * - `stale`     — they answered a question number that is no longer the one on
 *                 screen, from a second tab; `sitting` is the current one.
 * - `invalid_choice` — not one of the options or "I don't know".
 */
export type AnswerError = "not_found" | "finished" | "stale" | "invalid_choice";

export type AnswerResult =
  | { ok: true; done: false; sitting: SittingView }
  | {
      ok: true;
      done: true;
      subject: SubjectKey;
      mode: "live" | "preview";
      questions: number;
      /** For Assessments Administrators only: strip with `withoutLevel` before answering a taker. */
      placement: Level;
      confidence: Confidence;
    }
  | { ok: false; error: AnswerError; sitting?: SittingView };

/** Longest time on one question worth recording; past this the taker walked away. */
const MAX_MS = 60 * 60 * 1000;

export async function answer(
  userId: string,
  attemptId: string,
  number: number,
  choice: number,
  random: () => number = Math.random,
): Promise<AnswerResult> {
  if (!Number.isInteger(choice) || choice < IDK || choice > 3) return { ok: false, error: "invalid_choice" };

  // Which questions it may draw from next is a plain read, made before the
  // lock below. Reading it inside the transaction took a second connection
  // while the first was held, so a handful of answers at once could take
  // every connection in the pool and stall waiting for one more.
  const [sitting] = await db
    .select({ subject: irisAttempts.subject, form: irisAttempts.form, mode: irisAttempts.mode })
    .from(irisAttempts)
    .where(and(eq(irisAttempts.id, attemptId), eq(irisAttempts.userId, userId)));
  if (!sitting) return { ok: false, error: "not_found" };
  const pool = await poolFor(sitting.subject as SubjectKey, sitting.form as Form, sitting.mode as "live" | "preview");

  // The lock is on this one sitting only, so two tabs cannot record two
  // answers to one question; other takers are never waiting on it.
  return db.transaction(async (tx) => {
    const [attempt] = await tx
      .select()
      .from(irisAttempts)
      .where(and(eq(irisAttempts.id, attemptId), eq(irisAttempts.userId, userId)))
      .for("update");
    if (!attempt) return { ok: false, error: "not_found" };
    if (attempt.finishedAt || !attempt.currentItemId) return { ok: false, error: "finished" };
    if (attempt.questions + 1 !== number) return { ok: false, error: "stale", sitting: viewOf(attempt) };

    const item = ITEMS_BY_ID.get(attempt.currentItemId)!;
    const correct = choice !== IDK && choice === item.answer;
    const history = await tx
      .select({
        id: irisResponses.itemId,
        level: irisResponses.level,
        subtopic: irisResponses.subtopic,
        correct: irisResponses.correct,
        phase: irisResponses.phase,
      })
      .from(irisResponses)
      .where(eq(irisResponses.attemptId, attempt.id))
      .orderBy(asc(irisResponses.seq));
    const asked = history as Asked[];

    const state = {
      level: attempt.level as Level,
      up: attempt.up,
      down: attempt.down,
      phase: attempt.phase as Phase,
      tieLeft: attempt.tieLeft,
    };
    const step = submit(state, asked, item, correct, pool, random);
    const now = new Date();
    const ms = Math.min(MAX_MS, Math.max(0, now.getTime() - (attempt.shownAt?.getTime() ?? now.getTime())));

    await tx.insert(irisResponses).values({
      attemptId: attempt.id,
      seq: asked.length + 1,
      itemId: item.id,
      itemVersion: item.version,
      level: item.level,
      subtopic: item.subtopic,
      choice,
      correct,
      ms,
      phase: step.phase,
      answeredAt: now,
    });

    const questions = asked.length + 1;
    const engine = {
      level: step.state.level,
      up: step.state.up,
      down: step.state.down,
      phase: step.state.phase,
      tieLeft: step.state.tieLeft,
      questions,
    };

    if (step.next) {
      const [updated] = await tx
        .update(irisAttempts)
        .set({ ...engine, currentItemId: step.next.id, shownAt: now })
        .where(eq(irisAttempts.id, attempt.id))
        .returning();
      return { ok: true, done: false, sitting: viewOf(updated!) };
    }

    const all: Asked[] = [...asked, { id: item.id, level: item.level, subtopic: item.subtopic, correct, phase: step.phase }];
    const placement = placementOf(all);
    const confidence = confidenceOf(all);
    await tx
      .update(irisAttempts)
      .set({
        ...engine,
        currentItemId: null,
        shownAt: null,
        finishedAt: now,
        placement,
        confidence,
      })
      .where(eq(irisAttempts.id, attempt.id));
    return {
      ok: true,
      done: true,
      subject: attempt.subject as SubjectKey,
      mode: attempt.mode as "live" | "preview",
      questions,
      placement,
      confidence,
    };
  });
}

/** A finished sitting as a taker may see it: everything but how they placed. */
export function withoutLevel<T extends { placement?: unknown; confidence?: unknown }>(
  result: T,
): Omit<T, "placement" | "confidence"> {
  const rest: Record<string, unknown> = { ...result };
  delete rest.placement;
  delete rest.confidence;
  return rest as Omit<T, "placement" | "confidence">;
}
