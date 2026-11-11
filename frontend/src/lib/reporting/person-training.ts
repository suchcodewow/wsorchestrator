/**
 * What an Assessments Viewer sees of a person's training beside their classes
 * on Reporting → Live Sessions: how they placed on the Diagnostic, and how far
 * they are through Coach Canary's videos and topics. Both are read from the
 * same places as their own pages (the Diagnostic's Records, the concept map).
 */

import "server-only";

import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { cohortSummary, personDetail, type CohortSummary } from "@/lib/iris/cohort";
import type { Level } from "@/lib/iris/engine";
import type { SubjectKey, Track } from "@/lib/iris/subjects";
import { getMap } from "@/lib/mimir/map/content";
import { listConceptStates } from "@/lib/mimir/map/progress";
import { conceptsInOrder, type MapLevel } from "@/lib/mimir/map/schema";

/** The Diagnostic's form that Records, and so this, reports on. */
const FORM = "A";

export type PersonDiagnostic = {
  name: string | null;
  track: Track | null;
  composite: number | null;
  /** Each finished subject's placement, in the Diagnostic's order. */
  sittings: { subject: SubjectKey; placement: Level; finishedAt: string }[];
  /** Everyone the Diagnostic placed, which the chart draws their shape against. */
  summary: CohortSummary;
};

/** Null when they have not finished a subject. */
export async function getPersonDiagnostic(userId: string): Promise<PersonDiagnostic | null> {
  const detail = await personDetail(userId, FORM);
  if (!detail) return null;
  const sittings = detail.sittings.flatMap((s) =>
    s.placement && s.finishedAt ? [{ subject: s.subject, placement: s.placement, finishedAt: s.finishedAt.toISOString() }] : [],
  );
  if (sittings.length === 0) return null;
  return { name: detail.name, track: detail.track, composite: detail.composite, sittings, summary: await cohortSummary(FORM) };
}

export type CanaryTopic = { id: string; name: string; hasVideo: boolean; watched: boolean; mastered: boolean };

export type PersonCoachCanary = {
  videos: { watched: number; total: number };
  topics: { mastered: number; total: number };
  /** The topics at each level, in the order they are studied. */
  levels: { level: MapLevel; name: string; topics: CanaryTopic[] }[];
};

/** Null while there is no concept map to measure them against. */
export async function getPersonCoachCanary(userId: string): Promise<PersonCoachCanary | null> {
  const [map, states] = await Promise.all([getMap(), listConceptStates(userId)]);
  if (!map) return null;
  const { content } = map;
  const topics = conceptsInOrder(content).map((c) => ({
    level: c.level,
    topic: {
      id: c.id,
      name: c.name,
      hasVideo: Boolean(c.video),
      watched: Boolean(c.video) && (states[c.id]?.completed ?? false),
      mastered: states[c.id]?.mastered ?? false,
    },
  }));
  return {
    videos: { watched: topics.filter((t) => t.topic.watched).length, total: topics.filter((t) => t.topic.hasVideo).length },
    topics: { mastered: topics.filter((t) => t.topic.mastered).length, total: topics.length },
    levels: ([1, 2, 3] as const).map((level) => ({
      level,
      name: content.levels.find((l) => l.level === level)?.name ?? `Level ${level * 100}`,
      topics: topics.filter((t) => t.level === level).map((t) => t.topic),
    })),
  };
}

/** The account behind an email, which the Diagnostic and Coach Canary key their records by; null before they sign in. */
export async function userIdOf(email: string): Promise<string | null> {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(sql`lower(${users.email})`, email.toLowerCase()))
    .limit(1);
  return row?.id ?? null;
}
