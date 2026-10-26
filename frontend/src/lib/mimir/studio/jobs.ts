/**
 * Mimir Studio's jobs in the database: asked for here, carried out by the
 * `mimir-studio` job (`trigger.ts`), which writes its progress and result back
 * to the same row. At most one deck is under way at a time, and one video per
 * concept; the partial unique indexes on the table hold that, so two clicks at
 * once cannot both start one.
 */

import "server-only";

import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  MIMIR_STUDIO_ACTIVE,
  mimirStudioJobs,
  type MimirStudioJobKind,
  type MimirStudioJobStatus,
} from "@/db/schema";
import type { MimirStudioJobSort } from "@/lib/list-specs";
import { pageWindow, toPage, type ListQuery, type Page } from "@/lib/paging";
import { orderFor, searchAny } from "@/lib/paging-sql";
import { isUuid } from "@/lib/utils";
import type { DeckInput, VideoInput } from "./shapes";

/**
 * A job that has not reported for this long has died with its container
 * (Cloud Run's timeout is three hours), and is marked failed so that another
 * can start.
 */
const STALE_AFTER_MS = 4 * 60 * 60 * 1000;

export type StudioJob = {
  id: string;
  kind: MimirStudioJobKind;
  status: MimirStudioJobStatus;
  conceptId: string | null;
  label: string;
  input: Record<string, unknown>;
  result: Record<string, unknown> | null;
  progress: string | null;
  error: string | null;
  requestedBy: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
};

type Row = typeof mimirStudioJobs.$inferSelect;

export function toJob(r: Row): StudioJob {
  return {
    id: r.id,
    kind: r.kind,
    status: r.status,
    conceptId: r.conceptId,
    label: r.label,
    input: r.input,
    result: r.result,
    progress: r.progress,
    error: r.error,
    requestedBy: r.requestedBy,
    createdAt: r.createdAt.toISOString(),
    startedAt: r.startedAt?.toISOString() ?? null,
    finishedAt: r.finishedAt?.toISOString() ?? null,
    updatedAt: r.updatedAt.toISOString(),
  };
}

/** Marks failed every job still under way that has stopped reporting. */
async function expireStale(): Promise<void> {
  await db
    .update(mimirStudioJobs)
    .set({ status: "failed", error: "The job stopped reporting and was given up on.", finishedAt: new Date(), updatedAt: new Date() })
    .where(and(inArray(mimirStudioJobs.status, MIMIR_STUDIO_ACTIVE), lt(mimirStudioJobs.updatedAt, new Date(Date.now() - STALE_AFTER_MS))));
}

const isUniqueViolation = (err: unknown) =>
  typeof err === "object" && err !== null && "code" in err && (err as { code: unknown }).code === "23505";

async function insertJob(values: typeof mimirStudioJobs.$inferInsert): Promise<StudioJob | "busy"> {
  await expireStale();
  try {
    const [row] = await db.insert(mimirStudioJobs).values(values).returning();
    return toJob(row!);
  } catch (err) {
    // drizzle wraps the driver's error; the code is on the cause.
    if (isUniqueViolation(err) || isUniqueViolation((err as { cause?: unknown }).cause)) return "busy";
    throw err;
  }
}

/** A deck job waiting for its file: "busy" while another deck is under way. */
export function createDeckJob(userId: string, input: DeckInput) {
  return insertJob({ kind: "deck", status: "uploading", label: input.fileName, input, requestedBy: userId });
}

/** A video job for `concept`, queued: "busy" while one for the same concept is under way. */
export function createVideoJob(userId: string, concept: { id: string; name: string }, input: VideoInput) {
  return insertJob({ kind: "video", status: "queued", conceptId: concept.id, label: concept.name, input, requestedBy: userId });
}

export async function getJob(id: string): Promise<StudioJob | null> {
  if (!isUuid(id)) return null;
  const [row] = await db.select().from(mimirStudioJobs).where(eq(mimirStudioJobs.id, id));
  return row ? toJob(row) : null;
}

/**
 * Moves a job from `from` to `to`, only if it is still in `from`: the claim
 * that keeps two requests from both acting on it. Null when it was not.
 */
export async function moveJob(
  id: string,
  kind: MimirStudioJobKind,
  from: MimirStudioJobStatus,
  to: MimirStudioJobStatus,
  set: Partial<Pick<Row, "progress" | "error" | "result" | "finishedAt">> = {},
): Promise<StudioJob | null> {
  if (!isUuid(id)) return null;
  const [row] = await db
    .update(mimirStudioJobs)
    .set({ ...set, status: to, updatedAt: new Date() })
    .where(and(eq(mimirStudioJobs.id, id), eq(mimirStudioJobs.kind, kind), eq(mimirStudioJobs.status, from)))
    .returning();
  return row ? toJob(row) : null;
}

/** Ends a job that could not be started or carried on. */
export async function failJob(id: string, error: string): Promise<void> {
  await db
    .update(mimirStudioJobs)
    .set({ status: "failed", error, finishedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(mimirStudioJobs.id, id), inArray(mimirStudioJobs.status, MIMIR_STUDIO_ACTIVE)));
}

const SORT_COLUMNS = {
  createdAt: mimirStudioJobs.createdAt,
  kind: mimirStudioJobs.kind,
  label: sql`lower(${mimirStudioJobs.label})`,
  status: mimirStudioJobs.status,
};

export type StudioJobFilter = { kind?: MimirStudioJobKind; conceptId?: string };

/** Jobs a page at a time, the newest first; searched by the deck's file name or the concept's name. */
export async function listJobs(query: ListQuery<MimirStudioJobSort>, filter: StudioJobFilter = {}): Promise<Page<StudioJob>> {
  await expireStale();
  const { limit, offset } = pageWindow(query.page);
  const rows = await db
    .select()
    .from(mimirStudioJobs)
    .where(
      and(
        filter.kind ? eq(mimirStudioJobs.kind, filter.kind) : undefined,
        filter.conceptId ? eq(mimirStudioJobs.conceptId, filter.conceptId) : undefined,
        searchAny(query.q, [mimirStudioJobs.label]),
      ),
    )
    .orderBy(...orderFor(SORT_COLUMNS[query.sort], query.dir, sql`${mimirStudioJobs.createdAt} desc`, mimirStudioJobs.id))
    .limit(limit)
    .offset(offset);
  return toPage(rows.map(toJob), query.page);
}

/** The latest deck job, for the Map tab to show; null before the first. */
export async function latestDeckJob(): Promise<StudioJob | null> {
  await expireStale();
  const [row] = await db
    .select()
    .from(mimirStudioJobs)
    .where(eq(mimirStudioJobs.kind, "deck"))
    .orderBy(desc(mimirStudioJobs.createdAt))
    .limit(1);
  return row ? toJob(row) : null;
}

/** Each of these concepts' latest video job, by concept id; at most one row per concept asked about. */
export async function latestVideoJobs(conceptIds: string[]): Promise<Record<string, StudioJob>> {
  if (conceptIds.length === 0) return {};
  await expireStale();
  const rows = await db
    .selectDistinctOn([mimirStudioJobs.conceptId])
    .from(mimirStudioJobs)
    .where(and(eq(mimirStudioJobs.kind, "video"), inArray(mimirStudioJobs.conceptId, conceptIds)))
    .orderBy(mimirStudioJobs.conceptId, desc(mimirStudioJobs.createdAt));
  return Object.fromEntries(rows.map((r) => [r.conceptId!, toJob(r)]));
}

/** What a list shows of a job: where it stands, not what it was given or made. */
export type StudioJobBrief = Pick<StudioJob, "id" | "status" | "progress" | "error" | "createdAt" | "finishedAt">;

/** `rows` each with its concept's latest video job, or null for one that has never had one. */
export async function withVideoJobs<T extends { conceptId: string }>(rows: T[]): Promise<(T & { job: StudioJobBrief | null })[]> {
  const jobs = await latestVideoJobs(rows.map((r) => r.conceptId));
  return rows.map((r) => {
    const j = jobs[r.conceptId];
    return { ...r, job: j ? { id: j.id, status: j.status, progress: j.progress, error: j.error, createdAt: j.createdAt, finishedAt: j.finishedAt } : null };
  });
}
