/**
 * Where each person is on each concept of the map: how far through its video
 * and where to resume, whether the coach has marked them as knowing it, and
 * whether the coach has asked them to watch the video. Everything here is the
 * signed-in person's own.
 */

import "server-only";

import { and, eq, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { mimirConceptProgress } from "@/db/schema";
import { COMPLETE_SHARE, MAP_CONCEPT_LIMIT, NO_STATE, startAt, type ConceptState } from "./schema";

export { NO_STATE, type ConceptState };

type Row = typeof mimirConceptProgress.$inferSelect;

function stateOf(row: Row): ConceptState {
  return {
    videoSeconds: row.videoSeconds,
    videoFurthest: row.videoFurthest,
    videoDuration: row.videoDuration,
    completed: row.videoCompletedAt !== null,
    mastered: row.masteredAt !== null,
    recommended: row.recommendedAt !== null && row.masteredAt === null,
    resumeAt: startAt(row.videoSeconds, row.videoDuration),
  };
}

/** This person's standing on every concept they have a row for; a concept with no row reads as `NO_STATE`. */
export async function listConceptStates(userId: string): Promise<Record<string, ConceptState>> {
  const rows = await db.select().from(mimirConceptProgress).where(eq(mimirConceptProgress.userId, userId)).limit(MAP_CONCEPT_LIMIT);
  return Object.fromEntries(rows.map((r) => [r.conceptId, stateOf(r)]));
}

export async function getConceptState(userId: string, conceptId: string): Promise<ConceptState> {
  const [row] = await db
    .select()
    .from(mimirConceptProgress)
    .where(and(eq(mimirConceptProgress.userId, userId), eq(mimirConceptProgress.conceptId, conceptId)));
  return row ? stateOf(row) : NO_STATE;
}

export type VideoReport = { position: number; duration: number; ended: boolean };

/**
 * Notes where the player is: the place to resume from, the furthest reached,
 * and, once they reach the end (or all but the last few seconds), that they
 * finished. Finishing is kept if they watch again.
 */
export async function saveVideoProgress(userId: string, conceptId: string, report: VideoReport): Promise<ConceptState> {
  const duration = report.duration;
  const position = report.ended ? duration : Math.min(Math.max(report.position, 0), duration);
  const done = report.ended || position >= duration * COMPLETE_SHARE;
  const now = new Date();
  const t = mimirConceptProgress;
  const [row] = await db
    .insert(t)
    .values({
      userId,
      conceptId,
      videoSeconds: position,
      videoFurthest: position,
      videoDuration: duration,
      videoCompletedAt: done ? now : null,
      videoUpdatedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [t.userId, t.conceptId],
      set: {
        videoSeconds: position,
        videoFurthest: sqlGreatest(t.videoFurthest, position),
        videoDuration: duration,
        videoCompletedAt: done ? sqlCoalesce(t.videoCompletedAt, now) : t.videoCompletedAt,
        videoUpdatedAt: now,
        updatedAt: now,
      },
    })
    .returning();
  return stateOf(row!);
}

/** The coach is satisfied they know it: the recommendation, if any, is over. */
export async function markMastered(userId: string, conceptId: string): Promise<void> {
  const now = new Date();
  const t = mimirConceptProgress;
  await db
    .insert(t)
    .values({ userId, conceptId, masteredAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: [t.userId, t.conceptId], set: { masteredAt: sqlCoalesce(t.masteredAt, now), recommendedAt: null, updatedAt: now } });
}

/** The coach asks them to watch the video. Not for something they have already shown they know. */
export async function markRecommended(userId: string, conceptId: string): Promise<void> {
  const now = new Date();
  const t = mimirConceptProgress;
  await db
    .insert(t)
    .values({ userId, conceptId, recommendedAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: [t.userId, t.conceptId],
      set: { recommendedAt: sqlIfNull(t.masteredAt, now, t.recommendedAt), updatedAt: now },
    });
}

const sqlGreatest = (column: AnyPgColumn, value: number): SQL => sql`greatest(${column}, ${value})`;
const sqlCoalesce = (column: AnyPgColumn, value: Date): SQL => sql`coalesce(${column}, ${value})`;
/** `value` unless already mastered, in which case the existing recommendation (null) stays. */
const sqlIfNull = (mastered: AnyPgColumn, value: Date, current: AnyPgColumn): SQL => sql`case when ${mastered} is null then coalesce(${current}, ${value}) else ${current} end`;
