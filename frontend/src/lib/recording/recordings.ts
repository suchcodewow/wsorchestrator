/**
 * Async recordings: the one link anyone records through, and the takes that
 * come back on it, each a camera stream and perhaps a screen stream, filed
 * under the name the person typed.
 *
 * The participant's browser records each stream locally and uploads it a
 * chunk at a time while it records, retrying until each lands (see
 * `lib/recording/uploader.ts`); the server only ever has to accept chunks in
 * any order, any number of times, and join them once the browser says the
 * stream has ended and every chunk is in.
 */

import "server-only";

import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  RECORDING_LIMITS,
  RECORDING_TRACK_KINDS,
  recordingLinks,
  recordingTracks,
  type RecordingTrackKind,
  type RecordingTrackStatus,
} from "@/db/schema";
import type { RecordingSort } from "@/lib/list-specs";
import { pageWindow, toPage, type ListQuery, type Page } from "@/lib/paging";
import { orderFor, searchAny } from "@/lib/paging-sql";
import { isUuid } from "@/lib/utils";
import {
  assemble,
  chunkSeqs,
  chunkUploadUrls,
  openTrackFile,
  removeTakeFiles,
  storageMode,
  type ByteRange,
  type TrackFile,
  type TrackKey,
} from "./storage";
import { RECORDING_RETENTION_DAYS, UPLOAD_STALLED_MS, UPLOAD_URL_BATCH, missingChunks, trackFileName } from "./video";

/** An assembly that has not finished in this long died with its server, and may be tried again. */
const STALE_ASSEMBLY_MS = 15 * 60_000;

export type RecordingLink = { id: string; createdAt: string };

export type RecordingTrackRow = {
  id: string;
  takeId: string;
  kind: RecordingTrackKind;
  mimeType: string;
  startedAt: string;
  offsetMs: number;
  contributor: string;
  status: RecordingTrackStatus;
  chunks: number | null;
  durationMs: number | null;
  fileBytes: number | null;
  error: string | null;
  lastChunkAt: string | null;
  /** Still uploading, but nothing has arrived for `UPLOAD_STALLED_MS`. */
  stalled: boolean;
};

/** One take as the list shows it: its streams rolled into one row. */
export type RecordingTakeRow = {
  takeId: string;
  contributor: string;
  startedAt: string;
  /** The longest stream's length, once known. */
  durationMs: number | null;
  /** Bytes of the files finished so far. */
  bytes: number;
  kinds: RecordingTrackKind[];
  /** failed if any stream failed, else uploading or assembling while any is, else ready. */
  status: RecordingTrackStatus;
  stalled: boolean;
};

export type RecordingTake = { takeId: string; contributor: string; startedAt: string; tracks: RecordingTrackRow[] };

/** Made within the retention window: older takes are purged, and never shown meanwhile. */
const keptSince = sql`now() - ${RECORDING_RETENTION_DAYS}::int * interval '1 day'`;

/** Uploading, with no chunk since `UPLOAD_STALLED_MS` ago (or since it started, if none came). */
const stalledTrack = sql`${recordingTracks.status} = 'uploading' and coalesce(${recordingTracks.lastChunkAt}, ${recordingTracks.startedAt}) < now() - ${Math.round(UPLOAD_STALLED_MS / 1000)}::int * interval '1 second'`;

const TRACK_COLUMNS = {
  id: recordingTracks.id,
  takeId: recordingTracks.takeId,
  kind: recordingTracks.kind,
  mimeType: recordingTracks.mimeType,
  startedAt: recordingTracks.startedAt,
  offsetMs: recordingTracks.offsetMs,
  contributor: recordingTracks.contributor,
  status: recordingTracks.status,
  chunks: recordingTracks.chunks,
  durationMs: recordingTracks.durationMs,
  fileBytes: recordingTracks.fileBytes,
  error: recordingTracks.error,
  lastChunkAt: recordingTracks.lastChunkAt,
  stalled: sql<boolean>`${stalledTrack}`,
};

type TrackSelect = Omit<RecordingTrackRow, "startedAt" | "lastChunkAt"> & { startedAt: Date; lastChunkAt: Date | null };

const toTrackRow = (t: TrackSelect): RecordingTrackRow => ({
  ...t,
  startedAt: t.startedAt.toISOString(),
  lastChunkAt: t.lastChunkAt ? t.lastChunkAt.toISOString() : null,
});

// ─── The link ───────────────────────────────────────────────────────────────

/** The link in use, or null before the first is made. */
export async function getActiveLink(): Promise<RecordingLink | null> {
  const [row] = await db
    .select({ id: recordingLinks.id, createdAt: recordingLinks.createdAt })
    .from(recordingLinks)
    .where(isNull(recordingLinks.retiredAt))
    .orderBy(sql`${recordingLinks.createdAt} desc`)
    .limit(1);
  return row ? { id: row.id, createdAt: row.createdAt.toISOString() } : null;
}

/**
 * Makes a new link and retires every other, in one transaction. The old link
 * stops filing new takes at once; uploads already under way on it finish.
 */
export async function replaceLink(actorId: string): Promise<RecordingLink> {
  return db.transaction(async (tx) => {
    await tx.update(recordingLinks).set({ retiredAt: new Date() }).where(isNull(recordingLinks.retiredAt));
    const [row] = await tx
      .insert(recordingLinks)
      .values({ createdBy: actorId })
      .returning({ id: recordingLinks.id, createdAt: recordingLinks.createdAt });
    return { id: row!.id, createdAt: row!.createdAt.toISOString() };
  });
}

/** Whether `id` is a link a new take may be recorded on: the one in use. */
export async function isActiveLink(id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const [row] = await db
    .select({ id: recordingLinks.id })
    .from(recordingLinks)
    .where(and(eq(recordingLinks.id, id), isNull(recordingLinks.retiredAt)));
  return Boolean(row);
}

// ─── Takes ──────────────────────────────────────────────────────────────────

const TAKE_COLUMNS = {
  takeId: recordingTracks.takeId,
  contributor: sql<string>`max(${recordingTracks.contributor})`,
  startedAt: sql<string>`min(${recordingTracks.startedAt})`,
  durationMs: sql<number | null>`max(${recordingTracks.durationMs})`,
  bytes: sql<number>`coalesce(sum(${recordingTracks.fileBytes}), 0)::float8`,
  kinds: sql<RecordingTrackKind[]>`array_agg(${recordingTracks.kind} order by ${recordingTracks.kind})`,
  status: sql<RecordingTrackStatus>`case
    when bool_or(${recordingTracks.status} = 'failed') then 'failed'
    when bool_or(${recordingTracks.status} = 'uploading') then 'uploading'
    when bool_or(${recordingTracks.status} = 'assembling') then 'assembling'
    else 'ready' end`,
  stalled: sql<boolean>`bool_or(${stalledTrack})`,
};

const SORT_COLUMNS = {
  startedAt: sql`min(${recordingTracks.startedAt})`,
  contributor: sql`lower(max(${recordingTracks.contributor}))`,
};

/** Every take, a page at a time, the newest first; searched by who recorded it. */
export async function listTakes(query: ListQuery<RecordingSort>): Promise<Page<RecordingTakeRow>> {
  const { limit, offset } = pageWindow(query.page);
  const rows = await db
    .select(TAKE_COLUMNS)
    .from(recordingTracks)
    .where(searchAny(query.q, [recordingTracks.contributor]))
    .groupBy(recordingTracks.takeId)
    .having(sql`min(${recordingTracks.startedAt}) > ${keptSince}`)
    .orderBy(...orderFor(SORT_COLUMNS[query.sort], query.dir, recordingTracks.takeId))
    .limit(limit)
    .offset(offset);
  return toPage(
    rows.map((r) => ({ ...r, startedAt: new Date(r.startedAt).toISOString(), bytes: Number(r.bytes) })),
    query.page,
  );
}

/** One take with each of its streams; null if there is no such take. */
export async function getTake(takeId: string): Promise<RecordingTake | null> {
  if (!isUuid(takeId)) return null;
  const tracks = (
    await db.select(TRACK_COLUMNS).from(recordingTracks).where(eq(recordingTracks.takeId, takeId)).orderBy(recordingTracks.kind)
  ).map(toTrackRow);
  if (tracks.length === 0) return null;
  if (tracks.some((t) => new Date(t.startedAt).getTime() < Date.now() - RECORDING_RETENTION_DAYS * 24 * 60 * 60_000)) {
    return null;
  }
  return {
    takeId,
    contributor: tracks.find((t) => t.contributor)?.contributor ?? "",
    startedAt: tracks.reduce((min, t) => (t.startedAt < min ? t.startedAt : min), tracks[0]!.startedAt),
    tracks,
  };
}

/** Who recorded the take removed, with every file of it; null if there was none. */
export async function deleteTake(takeId: string): Promise<string | null> {
  if (!isUuid(takeId)) return null;
  const rows = await db
    .delete(recordingTracks)
    .where(eq(recordingTracks.takeId, takeId))
    .returning({ contributor: recordingTracks.contributor });
  if (rows.length === 0) return null;
  await removeTakeFiles(takeId);
  return rows.find((r) => r.contributor)?.contributor ?? "";
}

/** How many expired takes one purge removes, so it stays a short job. */
const PURGE_BATCH = 20;

/**
 * Deletes takes older than the retention window, rows and files, a few at a
 * time, and says which: the caller records each in the audit trail as the
 * app's own doing. Run after a new take is filed, so it keeps pace with use
 * without a scheduler. In a bucket the lifecycle rule has usually removed the
 * files already; deleting them again finds nothing.
 */
export async function purgeExpiredTakes(): Promise<{ takeId: string; contributor: string }[]> {
  const expired = await db
    .select({ takeId: recordingTracks.takeId, contributor: sql<string>`max(${recordingTracks.contributor})` })
    .from(recordingTracks)
    .groupBy(recordingTracks.takeId)
    .having(sql`min(${recordingTracks.startedAt}) <= ${keptSince}`)
    .limit(PURGE_BATCH);
  for (const { takeId } of expired) {
    await removeTakeFiles(takeId);
    await db.delete(recordingTracks).where(eq(recordingTracks.takeId, takeId));
  }
  return expired;
}

// ─── Uploading ──────────────────────────────────────────────────────────────

/** "direct": the browser uploads chunks to the bucket on signed URLs. "app": through the chunk route. */
export const uploadMode = (): "direct" | "app" => (storageMode() === "bucket" ? "direct" : "app");

export const registerTrackSchema = z.object({
  takeId: z.string().uuid(),
  kind: z.enum(RECORDING_TRACK_KINDS),
  mimeType: z
    .string()
    .max(RECORDING_LIMITS.mimeType)
    .regex(/^video\/(mp4|webm)(;.*)?$/),
  startedAt: z.string().datetime({ offset: true }).transform((s) => new Date(s)),
  offsetMs: z.number().int().min(0).max(60_000),
  /** Absent from a take recorded before the page asked for a name. */
  contributor: z.string().trim().max(RECORDING_LIMITS.contributor).default(""),
});

export type RegisterTrackFields = z.infer<typeof registerTrackSchema>;

/**
 * Files a stream before its first chunk. Saying so again, as a browser does
 * after every reload, changes nothing, even once the link has been replaced;
 * a new take needs the link in use. Null when neither holds, or the take is
 * already on another link.
 */
export async function registerTrack(linkId: string, fields: RegisterTrackFields): Promise<RecordingTrackRow | null> {
  const existing = await findTrack(linkId, fields.takeId, fields.kind);
  if (existing) return existing;
  if (!(await isActiveLink(linkId))) return null;
  await db
    .insert(recordingTracks)
    .values({ linkId, ...fields })
    .onConflictDoNothing({ target: [recordingTracks.takeId, recordingTracks.kind] });
  return findTrack(linkId, fields.takeId, fields.kind);
}

/** One stream of one take recorded on `linkId`, or null. */
export async function findTrack(linkId: string, takeId: string, kind: string): Promise<RecordingTrackRow | null> {
  if (!isUuid(linkId) || !isUuid(takeId) || !RECORDING_TRACK_KINDS.includes(kind as RecordingTrackKind)) return null;
  const [row] = await db
    .select(TRACK_COLUMNS)
    .from(recordingTracks)
    .where(
      and(
        eq(recordingTracks.linkId, linkId),
        eq(recordingTracks.takeId, takeId),
        eq(recordingTracks.kind, kind as RecordingTrackKind),
      ),
    );
  return row ? toTrackRow(row) : null;
}

const keyOf = (t: Pick<RecordingTrackRow, "takeId" | "kind">): TrackKey => ({ takeId: t.takeId, kind: t.kind });

/** Whether a track still takes chunks: not once its file has been joined. */
export const acceptsChunks = (t: RecordingTrackRow) => t.status === "uploading" || t.status === "failed";

/**
 * Marks the stream as still arriving. Through the app that is each chunk;
 * straight to a bucket the app never sees a chunk, so it is each request for
 * upload URLs, which a browser makes about once a minute while it uploads.
 * `UPLOAD_STALLED_MS` is set well past that.
 */
export async function noteChunk(trackId: string): Promise<void> {
  await db.update(recordingTracks).set({ lastChunkAt: new Date() }).where(eq(recordingTracks.id, trackId));
}

export const uploadUrlsSchema = z.object({
  seqs: z.array(z.number().int().min(0).max(RECORDING_LIMITS.chunks - 1)).min(1).max(UPLOAD_URL_BATCH),
});

/** Signed URLs to upload chunks `seqs` of a stream straight to the bucket, good for an hour. */
export async function uploadUrls(track: RecordingTrackRow, seqs: number[]): Promise<Record<number, string>> {
  const urls = await chunkUploadUrls(keyOf(track), [...new Set(seqs)]);
  await noteChunk(track.id);
  return urls;
}

export const finishTrackSchema = z.object({
  /** 0 when the browser saved nothing at all for the stream. */
  chunks: z.number().int().min(0).max(RECORDING_LIMITS.chunks),
  durationMs: z.number().int().min(0).max(24 * 60 * 60_000),
});

export type FinishResult =
  | { status: "missing"; missing: number[] }
  | { status: Exclude<RecordingTrackStatus, "uploading"> };

/**
 * The browser says the stream ended after `chunks` chunks. If any is not here
 * yet, says which, and the browser sends them again. Otherwise claims the
 * track — only one of two racing calls can — and joins the file.
 *
 * In a bucket the join is a few compose calls, so it happens here, before
 * answering: Cloud Run throttles the CPU once a response is sent, which would
 * stall work left for later. Only the clean-up of the chunks goes to
 * `schedule` (the route's `after()`); whatever it misses, the bucket's
 * lifecycle rule removes. On disk the join is a copy of the whole file, so it
 * all goes to `schedule` and the browser hears `assembling` until it is done.
 */
export async function finishTrack(
  track: RecordingTrackRow,
  fields: z.infer<typeof finishTrackSchema>,
  schedule: (job: () => Promise<void>) => void,
): Promise<FinishResult> {
  if (track.status === "ready") return { status: "ready" };

  if (fields.chunks === 0) {
    await db
      .update(recordingTracks)
      .set({
        status: "failed",
        chunks: 0,
        durationMs: fields.durationMs,
        error: "Nothing was saved for this stream: the page was most likely closed before the browser wrote any of it out.",
        updatedAt: new Date(),
      })
      .where(and(eq(recordingTracks.id, track.id), inArray(recordingTracks.status, ["uploading", "failed"])));
    return { status: "failed" };
  }

  const key = keyOf(track);
  const missing = missingChunks(await chunkSeqs(key), fields.chunks);
  if (missing.length > 0) {
    return { status: "missing", missing: missing.slice(0, 1_000) };
  }

  const staleBefore = new Date(Date.now() - STALE_ASSEMBLY_MS);
  const [claimed] = await db
    .update(recordingTracks)
    .set({ status: "assembling", chunks: fields.chunks, durationMs: fields.durationMs, error: null, updatedAt: new Date() })
    .where(
      and(
        eq(recordingTracks.id, track.id),
        or(
          inArray(recordingTracks.status, ["uploading", "failed"]),
          and(eq(recordingTracks.status, "assembling"), lt(recordingTracks.updatedAt, staleBefore)),
        ),
      ),
    )
    .returning({ id: recordingTracks.id });
  if (!claimed) return { status: "assembling" };

  const join = async (): Promise<FinishResult> => {
    try {
      const { bytes, cleanUp } = await assemble(key, fields.chunks, track.mimeType);
      await db
        .update(recordingTracks)
        .set({ status: "ready", fileBytes: bytes, updatedAt: new Date() })
        .where(eq(recordingTracks.id, track.id));
      schedule(() => cleanUp().catch((err) => console.error("recording: chunk clean-up failed", track.id, err)));
      return { status: "ready" };
    } catch (err) {
      console.error("recording: assembly failed", track.id, err);
      await db
        .update(recordingTracks)
        .set({ status: "failed", error: String((err as Error)?.message ?? err).slice(0, 500), updatedAt: new Date() })
        .where(eq(recordingTracks.id, track.id));
      return { status: "failed" };
    }
  };

  if (storageMode() === "bucket") return join();
  schedule(async () => {
    await join();
  });
  return { status: "assembling" };
}

/** A finished stream's file, with the name it downloads as; null until it is ready. */
export async function openRecordingFile(
  takeId: string,
  kind: string,
  options: { download: boolean; pickRange?: (bytes: number) => ByteRange | null },
): Promise<{ name: string; mimeType: string; file: TrackFile } | null> {
  if (!isUuid(takeId) || !RECORDING_TRACK_KINDS.includes(kind as RecordingTrackKind)) return null;
  const [row] = await db
    .select(TRACK_COLUMNS)
    .from(recordingTracks)
    .where(and(eq(recordingTracks.takeId, takeId), eq(recordingTracks.kind, kind as RecordingTrackKind)));
  if (!row || row.status !== "ready") return null;

  const name = trackFileName({ contributor: row.contributor, startedAt: row.startedAt, kind: row.kind, mimeType: row.mimeType });
  const file = await openTrackFile(keyOf(row), row.mimeType, { name, ...options });
  return file ? { name, mimeType: row.mimeType, file } : null;
}
