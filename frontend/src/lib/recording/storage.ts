/**
 * Where an async recording's video is kept: each chunk as the browser
 * uploads it, then the finished file once every chunk is in.
 *
 * Two places, chosen by configuration:
 *
 *   * **A Cloud Storage bucket** when `RECORDINGS_BUCKET` is set, as it is on
 *     every deployment (`infra/admin/recordings.tf`). The browser uploads each
 *     chunk straight to the bucket on a signed URL, the file is joined by
 *     composing the chunks inside the bucket, and downloads are signed URLs
 *     too: no video passes through the app. Point `STORAGE_EMULATOR_HOST` at
 *     fake-gcs-server to develop against this without a bucket.
 *
 *   * **Local disk** otherwise, under `RECORDINGS_DIR` (`frontend/.recordings`
 *     by default): chunks come through the app's own upload route and the
 *     file is joined there, remuxed by ffmpeg when it is on the PATH — streams
 *     copied, nothing re-encoded — into one an editor seeks in as it would a
 *     camera's. Fine on one machine; Cloud Run's disk is memory, and not
 *     shared between instances, so never there.
 *
 * Chunks are byte ranges of one stream, so either way the file is their
 * concatenation in order. A joined file not remuxed (the bucket's always is
 * not) is a fragmented MP4 or a WebM without a duration: it plays everywhere,
 * but some editors seek in it slowly.
 *
 * Objects in the bucket, which its lifecycle rules depend on:
 *   chunks/{takeId}/{kind}/{seq}       what the browser uploads
 *   compose/{takeId}/{kind}/{n}        intermediate joins, 32 at a time
 *   files/{takeId}/{kind}.{mp4|webm}   the finished file
 */

import "server-only";

import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { RecordingTrackKind } from "@/db/schema";
import { COMPOSE_LIMIT, compose, deleteObject, listObjects, objectSize, signedUrl } from "./gcs";
import { videoContentType, videoExtensionFor } from "./video";

export type TrackKey = { takeId: string; kind: RecordingTrackKind };
export type ByteRange = { start: number; end: number };

/** How long an upload or download URL stays good. Long enough for a slow chunk; a fresh one is asked for after. */
const UPLOAD_URL_SECONDS = 60 * 60;
const DOWNLOAD_URL_SECONDS = 15 * 60;
/** Compose calls in flight at once while joining. */
const PARALLEL_COMPOSES = 8;
const PARALLEL_DELETES = 16;

const bucket = () => process.env.RECORDINGS_BUCKET || null;

/** "bucket": the browser uploads to Cloud Storage. "disk": it uploads through the app. */
export const storageMode = (): "bucket" | "disk" => (bucket() ? "bucket" : "disk");

const seqName = (seq: number) => String(seq).padStart(6, "0");

// ─── Uploading ──────────────────────────────────────────────────────────────

/** Signed URLs to PUT chunks `seqs` of a stream straight into the bucket. */
export async function chunkUploadUrls(key: TrackKey, seqs: number[]): Promise<Record<number, string>> {
  const b = bucket();
  if (!b) throw new Error("Chunks go through the app when recordings are kept on disk.");
  const entries = await Promise.all(
    seqs.map(async (seq) => {
      const url = await signedUrl({ method: "PUT", bucket: b, object: chunkObject(key, seq), expiresSeconds: UPLOAD_URL_SECONDS });
      return [seq, url] as const;
    }),
  );
  return Object.fromEntries(entries);
}

/**
 * Keeps chunk `seq` on disk. Written aside and renamed into place, so a chunk
 * is either all there or not at all; uploading the same one again replaces
 * it, which is what makes a retry after a lost response safe.
 */
export async function putChunk(key: TrackKey, seq: number, data: Uint8Array): Promise<void> {
  if (bucket()) throw new Error("Chunks go straight to the bucket; this deployment has no upload route.");
  await mkdir(chunkDir(key), { recursive: true });
  const final = chunkPath(key, seq);
  const partial = `${final}.${process.pid}.${Date.now()}.part`;
  await writeFile(partial, data);
  await rename(partial, final);
}

/** The sequence numbers of the chunks kept for a stream. */
export async function chunkSeqs(key: TrackKey): Promise<number[]> {
  const b = bucket();
  if (b) {
    const objects = await listObjects(b, chunkPrefix(key));
    return objects.filter((o) => o.size > 0).map((o) => Number(o.name.slice(o.name.lastIndexOf("/") + 1)));
  }
  const names = await readdir(chunkDir(key)).catch(() => [] as string[]);
  return names.filter((n) => /^\d{6,}$/.test(n)).map(Number);
}

// ─── Joining ────────────────────────────────────────────────────────────────

/**
 * Joins chunks `0` to `total - 1` into the stream's file; the caller has
 * checked that all of them are there. Returns the file's size, and the
 * clean-up of what it was made from, for the caller to run once it has
 * answered: chunks the clean-up misses, the bucket's lifecycle removes.
 */
export async function assemble(
  key: TrackKey,
  total: number,
  mimeType: string,
): Promise<{ bytes: number; cleanUp: () => Promise<void> }> {
  const b = bucket();
  return b ? assembleInBucket(b, key, total, mimeType) : assembleOnDisk(key, total, mimeType);
}

/**
 * Composes the chunks 32 at a time, then those 32 at a time, until one
 * object is left. An hour of 2-second chunks is about 1,800, so about 60
 * compose calls in three rounds, each round's calls in parallel: seconds, in
 * the bucket, with no bytes through the app.
 */
async function assembleInBucket(b: string, key: TrackKey, total: number, mimeType: string) {
  const contentType = videoContentType(mimeType);
  const file = fileObject(key, mimeType);
  let level = Array.from({ length: total }, (_, seq) => chunkObject(key, seq));
  const intermediates: string[] = [];
  for (let round = 0; level.length > COMPOSE_LIMIT; round++) {
    const groups = chunkArray(level, COMPOSE_LIMIT);
    const next = groups.map((_, i) => `${composePrefix(key)}${round}-${String(i).padStart(4, "0")}`);
    await inBatches(groups.map((group, i) => () => compose(b, group, next[i]!, contentType)), PARALLEL_COMPOSES);
    intermediates.push(...next);
    level = next;
  }
  await compose(b, level, file, contentType);
  const bytes = await objectSize(b, file);
  if (bytes === null) throw new Error("The joined file is not in the bucket.");

  const made = [...Array.from({ length: total }, (_, seq) => chunkObject(key, seq)), ...intermediates];
  return { bytes, cleanUp: () => inBatches(made.map((name) => () => deleteObject(b, name)), PARALLEL_DELETES) };
}

async function assembleOnDisk(key: TrackKey, total: number, mimeType: string) {
  const out = filePath(key, mimeType);
  const joined = `${out}.joined`;

  await pipeline(
    Readable.from(
      (async function* () {
        for (let seq = 0; seq < total; seq++) {
          for await (const piece of createReadStream(chunkPath(key, seq))) yield piece as Buffer;
        }
      })(),
    ),
    createWriteStream(joined),
  );

  if (await remux(joined, out)) await rm(joined, { force: true });
  else await rename(joined, out);

  return {
    bytes: (await stat(out)).size,
    cleanUp: () => rm(chunkDir(key), { recursive: true, force: true }),
  };
}

/** Copies `input`'s streams into a proper file at `output`; false when ffmpeg is missing or fails. */
function remux(input: string, output: string): Promise<boolean> {
  const mp4 = output.endsWith(".mp4");
  const args = ["-hide_banner", "-loglevel", "error", "-y", "-fflags", "+genpts", "-i", input, "-map", "0", "-c", "copy"];
  if (mp4) args.push("-movflags", "+faststart");
  args.push(`${output}.remux${path.extname(output)}`);

  return new Promise((resolve) => {
    const child = spawn(process.env.FFMPEG_PATH || "ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", () => resolve(false));
    child.on("close", async (code) => {
      if (code !== 0) {
        console.error("recording: ffmpeg remux failed, serving the joined file", stderr.slice(0, 500));
        await rm(`${output}.remux${path.extname(output)}`, { force: true });
        return resolve(false);
      }
      await rename(`${output}.remux${path.extname(output)}`, output);
      resolve(true);
    });
  });
}

// ─── Reading and removing ───────────────────────────────────────────────────

export type TrackFile =
  /** The file is in the bucket: send the browser here, a signed URL good for 15 minutes. */
  | { redirect: string }
  /** The file is on disk: serve these bytes. */
  | { stream: ReadableStream<Uint8Array>; bytes: number; range: ByteRange | null };

/**
 * The finished file: a signed URL to it in the bucket, or a stream of it from
 * disk — all of it, or what `pickRange` asks for once it knows the size.
 * Null if it is not there.
 */
export async function openTrackFile(
  key: TrackKey,
  mimeType: string,
  options: { name: string; download: boolean; pickRange?: (bytes: number) => ByteRange | null },
): Promise<TrackFile | null> {
  const b = bucket();
  if (b) {
    const disposition = `${options.download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(options.name)}`;
    const url = await signedUrl({
      method: "GET",
      bucket: b,
      object: fileObject(key, mimeType),
      expiresSeconds: DOWNLOAD_URL_SECONDS,
      query: { "response-content-disposition": disposition, "response-content-type": videoContentType(mimeType) },
    });
    return { redirect: url };
  }
  const file = filePath(key, mimeType);
  const info = await stat(file).catch(() => null);
  if (!info) return null;
  const range = options.pickRange?.(info.size) ?? null;
  const node = createReadStream(file, range ?? undefined);
  return { stream: Readable.toWeb(node) as ReadableStream<Uint8Array>, bytes: info.size, range };
}

/** Removes everything kept for a take: each stream's chunks, intermediate joins and file. */
export async function removeTakeFiles(takeId: string): Promise<void> {
  const b = bucket();
  if (!b) {
    await rm(path.join(diskRoot(), takeId), { recursive: true, force: true });
    return;
  }
  const objects = (
    await Promise.all(["chunks", "compose", "files"].map((top) => listObjects(b, `${top}/${takeId}/`)))
  ).flat();
  await inBatches(objects.map((o) => () => deleteObject(b, o.name)), PARALLEL_DELETES);
}

// ─── Names ──────────────────────────────────────────────────────────────────

/** Every id in a key has been checked as a UUID by the caller, so none can climb out of where it belongs. */
const chunkPrefix = (key: TrackKey) => `chunks/${key.takeId}/${key.kind}/`;
const chunkObject = (key: TrackKey, seq: number) => `${chunkPrefix(key)}${seqName(seq)}`;
const composePrefix = (key: TrackKey) => `compose/${key.takeId}/${key.kind}/`;
const fileObject = (key: TrackKey, mimeType: string) => `files/${key.takeId}/${key.kind}.${videoExtensionFor(mimeType)}`;

const diskRoot = () => path.resolve(process.env.RECORDINGS_DIR || path.join(process.cwd(), ".recordings"));
const trackDir = (key: TrackKey) => path.join(diskRoot(), key.takeId, key.kind);
const chunkDir = (key: TrackKey) => path.join(trackDir(key), "chunks");
const chunkPath = (key: TrackKey, seq: number) => path.join(chunkDir(key), seqName(seq));
const filePath = (key: TrackKey, mimeType: string) => path.join(trackDir(key), `recording.${videoExtensionFor(mimeType)}`);

function chunkArray<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Runs the jobs `width` at a time, and fails with the first that fails. */
async function inBatches(jobs: (() => Promise<unknown>)[], width: number): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) await jobs[next++]!();
  };
  await Promise.all(Array.from({ length: Math.min(width, jobs.length) }, worker));
}
