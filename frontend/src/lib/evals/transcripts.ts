/**
 * Transcripts of the recordings judges make while scoring. The judge's
 * browser keeps the audio; when a recording stops it sends it here once, and
 * what is kept is Deepgram's transcript of it, filed by bootcamp, assessment
 * and attendee as their submission is. Anyone who can open the scoring form
 * reads every transcript filed for that attendee, whoever recorded it.
 *
 * Nothing here checks who may score whom: the route does, with
 * `scoringTarget`, before it files anything.
 */

import "server-only";

import { and, asc, count, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { evalsTranscripts, users } from "@/db/schema";
import { PAGE_SIZE } from "@/lib/paging";
import { transcribe } from "@/lib/recording/transcription";

const t = evalsTranscripts;

/** Where one attendee's transcripts on one assessment at one bootcamp are filed. */
export type TranscriptFiling = { bootcampId: string; assessmentId: string; attendeeEmail: string };

export type Transcript = {
  id: string;
  /** The recording's id in the browser that made it. */
  recordingId: string;
  recordedAt: Date;
  durationMs: number;
  /** Null for a recording whose maker's name was never known. */
  recordedByName: string | null;
  /** Empty when Deepgram heard nothing. */
  text: string;
};

/** The most kept for one filing, and so the most one read returns. */
export const MAX_TRANSCRIPTS = PAGE_SIZE;

const COLUMNS = {
  id: t.id,
  recordingId: t.recordingId,
  recordedAt: t.recordedAt,
  durationMs: t.durationMs,
  recordedByName: sql<string | null>`nullif(${t.recordedByName}, '')`,
  text: t.text,
};

function filedAs({ bootcampId, assessmentId, attendeeEmail }: TranscriptFiling) {
  return and(eq(t.bootcampId, bootcampId), eq(t.assessmentId, assessmentId), eq(t.attendeeEmail, attendeeEmail));
}

/** Every transcript filed for one attendee on one assessment at one bootcamp, oldest recording first. */
export async function listTranscripts(filing: TranscriptFiling): Promise<Transcript[]> {
  return db.select(COLUMNS).from(t).where(filedAs(filing)).orderBy(asc(t.recordedAt), asc(t.id)).limit(MAX_TRANSCRIPTS);
}

export type TranscriptInput = { recordingId: string; recordedAt: Date; durationMs: number; audio: Blob };

export type TranscriptError =
  /** No Deepgram key on this deployment. */
  | "unconfigured"
  /** Deepgram refused it or could not be reached. */
  | "upstream"
  | "too_many"
  /** That recording is already filed for someone else. */
  | "conflict";

export const TRANSCRIPT_STATUS_FOR: Record<TranscriptError, number> = {
  unconfigured: 503,
  upstream: 502,
  too_many: 409,
  conflict: 409,
};

/**
 * Transcribes one recording and files it. A recording sent again — a retry
 * after a lost response — returns the transcript already filed, with
 * `created: false`, and is not sent to Deepgram a second time.
 */
export async function saveTranscript(
  actorId: string,
  filing: TranscriptFiling,
  input: TranscriptInput,
): Promise<
  | { ok: true; transcript: Transcript; created: boolean }
  | { ok: false; error: TranscriptError; detail?: string }
> {
  const already = async () => {
    const [row] = await db
      .select({ ...COLUMNS, bootcampId: t.bootcampId, assessmentId: t.assessmentId, attendeeEmail: t.attendeeEmail })
      .from(t)
      .where(eq(t.recordingId, input.recordingId));
    if (!row) return null;
    const { bootcampId, assessmentId, attendeeEmail, ...transcript } = row;
    const same =
      bootcampId === filing.bootcampId && assessmentId === filing.assessmentId && attendeeEmail === filing.attendeeEmail;
    return same
      ? ({ ok: true, transcript, created: false } as const)
      : ({ ok: false, error: "conflict" } as const);
  };

  const found = await already();
  if (found) return found;

  const [filed] = await db.select({ n: count() }).from(t).where(filedAs(filing));
  if ((filed?.n ?? 0) >= MAX_TRANSCRIPTS) return { ok: false, error: "too_many" };

  const got = await transcribe(input.audio);
  if ("error" in got) return got.detail ? { ok: false, error: got.error, detail: got.detail } : { ok: false, error: got.error };

  const [maker] = await db
    .select({ name: sql<string>`coalesce(nullif(${users.name}, ''), ${users.email}, '')` })
    .from(users)
    .where(eq(users.id, actorId));
  const [inserted] = await db
    .insert(t)
    .values({
      ...filing,
      recordingId: input.recordingId,
      recordedById: actorId,
      recordedByName: maker?.name ?? "",
      recordedAt: input.recordedAt,
      durationMs: input.durationMs,
      text: got.transcript,
    })
    .onConflictDoNothing({ target: t.recordingId })
    .returning(COLUMNS);
  if (inserted) return { ok: true, transcript: inserted, created: true };

  // The same recording was filed by another request while Deepgram worked on this one.
  return (await already()) ?? { ok: false, error: "conflict" };
}
