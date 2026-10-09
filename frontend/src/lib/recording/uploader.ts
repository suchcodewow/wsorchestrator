/**
 * Sends a participant's async recordings to the server, from this browser's
 * recordings store, until every stream is in and joined.
 *
 * Chunks go straight to Cloud Storage on signed URLs the app hands out a
 * batch at a time, or, where recordings are kept on the app's disk, through
 * its chunk route; the server says which when a stream is filed.
 *
 * It runs beside the recorder, not after it: chunks go up while the take is
 * still being recorded, so on a good connection there is little left to send
 * when it stops. On a poor one it simply falls behind — the recording itself
 * is local and never waits on the network — and catches up afterwards.
 *
 * Every step can be repeated safely, which is what makes it survive a bad
 * connection: a stream is filed again on every pass, a chunk whose response
 * was lost is sent again and replaces itself, and the server answers "finish"
 * with whatever it still lacks. Failures back off from one second to half a
 * minute — but only while nothing gets through: a pass that lands any chunk
 * resets it, so a connection that drops one upload in three keeps moving
 * rather than waiting longer and longer. Coming back online retries at once. Which chunks have landed is
 * kept in IndexedDB, so a reload or a crashed tab resumes where it stopped.
 * A stream is deleted from this browser only once the server says its file
 * is ready.
 */

import { deleteRecording, listUploads, markNotUploaded, markUploaded, readChunk, uploadProgress, type StoredRecording } from "./store";
import { UPLOAD_URL_BATCH, retryDelayMs } from "./video";

/** Chunks in flight at once, across every stream. */
const PARALLEL_UPLOADS = 3;
/** Long enough for a 2 MB chunk on a slow uplink; a hung request is retried rather than waited on forever. */
const CHUNK_TIMEOUT_MS = 90_000;
/** For the small JSON requests: filing a stream, asking for upload URLs, finishing it. */
const REQUEST_TIMEOUT_MS = 30_000;
/** How long a signed upload URL is used for; the server signs them for an hour. */
const URL_REUSE_MS = 40 * 60_000;
/** How often to look for new chunks while nothing is pending. */
const IDLE_MS = 1_000;
/** How often to ask about a file that is being joined. */
const ASSEMBLY_POLL_MS = 3_000;

export type StreamUpload = {
  recordingId: string;
  takeId: string;
  kind: "camera" | "screen";
  recording: boolean;
  chunks: number;
  uploaded: number;
  bytes: number;
  /** The server is joining the file; it is deleted from here once that is done. */
  assembling: boolean;
};

export type UploadSnapshot = {
  /** This browser's store has been read at least once, so `streams` says what it holds. */
  loaded: boolean;
  streams: StreamUpload[];
  /** Streams the server has said are ready while this page was open, oldest first: the recorder can download them. */
  completed: { takeId: string; kind: "camera" | "screen" }[];
  /** The last attempt failed and the next is waiting; why, in a few words. */
  retrying: string | null;
  online: boolean;
  /** The take is another account's, or was deleted: nothing more can be sent. */
  gone: boolean;
};

/** The take is not this account's to upload, or no longer exists: nothing more can be sent. */
class Gone extends Error {}

/** A refused request, said so a participant knows what to do: signed out is the one they can fix. */
function answered(res: Response): Error {
  if (res.status === 401) return new Error("you're signed out, so reload this page and sign in again");
  return new Error(`the server answered ${res.status}`);
}

export class RecordingUploader {
  private stopped = false;
  private failures = 0;
  /** Some chunk landed during the current pass. */
  private progressed = false;
  /** Cut the current retry delay short: the browser is back online. */
  private retryNow = false;
  private wake: (() => void) | null = null;
  /** Streams filed this session, and how each one's chunks go up: to the bucket, or through the app. */
  private registered = new Map<string, "direct" | "app">();
  /** Signed upload URLs in hand, per stream, and the batch being asked for. */
  private urls = new Map<string, Map<number, { url: string; until: number }>>();
  private asking = new Map<string, Promise<void>>();
  /** Streams the server says are already joined: their chunks are all in. */
  private finished = new Set<string>();
  private snapshot: UploadSnapshot = { loaded: false, streams: [], completed: [], retrying: null, online: true, gone: false };

  constructor(
    private readonly ownerId: string,
    private readonly onChange: (snapshot: UploadSnapshot) => void,
  ) {}

  start(): () => void {
    const online = () => {
      this.failures = 0;
      this.retryNow = true;
      this.update({ online: true });
      this.poke();
    };
    const offline = () => this.update({ online: false });
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    this.update({ online: navigator.onLine });
    void this.run();
    return () => {
      this.stopped = true;
      this.poke();
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
    };
  }

  /** Look again now: a chunk was just saved, or a take stopped. */
  poke(): void {
    this.wake?.();
  }

  private update(patch: Partial<UploadSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.onChange(this.snapshot);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(done, ms);
      function done() {
        clearTimeout(timer);
        resolve();
      }
      this.wake = done;
    });
  }

  private async run() {
    while (!this.stopped) {
      let busy = false;
      try {
        busy = await this.pass();
        if (this.failures > 0) this.update({ retrying: null });
        this.failures = 0;
      } catch (err) {
        if (err instanceof Gone) {
          this.update({ gone: true, retrying: null });
          return;
        }
        if (this.progressed) this.failures = 0;
        this.update({ retrying: describe(err) });
        await this.backoff(retryDelayMs(this.failures++));
        continue;
      }
      if (!busy) await this.sleep(this.snapshot.streams.some((s) => s.assembling) ? ASSEMBLY_POLL_MS : IDLE_MS);
    }
  }

  /** Waits out a retry delay, still showing what is recorded meanwhile; coming back online cuts it short. */
  private async backoff(ms: number) {
    const until = Date.now() + ms;
    this.retryNow = false;
    while (!this.stopped && !this.retryNow && Date.now() < until) {
      await this.sleep(until - Date.now());
      await this.refresh().catch(() => {});
    }
  }

  private async load() {
    const recordings = await listUploads(this.ownerId);
    const progress = new Map(await Promise.all(recordings.map(async (r) => [r.id, await uploadProgress(r.id)] as const)));
    return { recordings, progress };
  }

  private streamsOf(
    recordings: StoredRecording[],
    progress: Map<string, { kept: number[]; uploaded: Set<number> }>,
    assembling: Set<string>,
  ): StreamUpload[] {
    return recordings.map((r) => {
      const p = progress.get(r.id)!;
      return {
        recordingId: r.id,
        takeId: r.upload!.takeId,
        kind: r.upload!.kind,
        recording: r.status === "recording",
        chunks: p.kept.length,
        uploaded: p.uploaded.size,
        bytes: r.bytes,
        assembling: assembling.has(r.id),
      };
    });
  }

  /** What this browser holds now, without touching the network. */
  private async refresh() {
    const { recordings, progress } = await this.load();
    const assembling = new Set(this.snapshot.streams.filter((s) => s.assembling).map((s) => s.recordingId));
    this.update({ loaded: true, streams: this.streamsOf(recordings, progress, assembling) });
  }

  /** One look at every stream: file it, send what is pending, finish what has ended. True if anything was sent. */
  private async pass(): Promise<boolean> {
    this.progressed = false;
    const { recordings, progress } = await this.load();
    const assembling = new Set(this.snapshot.streams.filter((s) => s.assembling).map((s) => s.recordingId));
    const publish = () => this.update({ loaded: true, streams: this.streamsOf(recordings, progress, assembling) });
    publish();

    for (const r of recordings) await this.register(r);

    const pending = recordings.flatMap((r) =>
      progress
        .get(r.id)!
        .kept.filter((seq) => !progress.get(r.id)!.uploaded.has(seq))
        .map((seq) => ({ r, seq })),
    );
    const queue = pending.sort((a, b) => a.seq - b.seq);
    // After a failure no worker takes another chunk, and the pass waits for the ones in flight, so two passes never overlap.
    let failed: unknown = null;
    const worker = async () => {
      for (let job = queue.shift(); job && !failed; job = queue.shift()) {
        try {
          await this.sendChunk(job.r, job.seq);
        } catch (err) {
          failed ??= err;
          return;
        }
        this.progressed = true;
        progress.get(job.r.id)!.uploaded.add(job.seq);
        publish();
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL_UPLOADS, queue.length) }, worker));
    if (failed) throw failed;

    for (const r of [...recordings]) {
      const p = progress.get(r.id)!;
      if (r.status === "recording" || p.uploaded.size < p.kept.length) continue;
      if (p.kept.length === 0) {
        // Stopped before the recorder handed anything over. Say so, so the stream does not wait on the server forever.
        await this.finish(r, 0);
        await deleteRecording(r.id);
        recordings.splice(recordings.indexOf(r), 1);
        publish();
        continue;
      }
      const answer = await this.finish(r, p.kept.length);
      if (answer.status === "missing") {
        await markNotUploaded(r.id, answer.missing);
        assembling.delete(r.id);
      } else if (answer.status === "ready") {
        const done = { takeId: r.upload!.takeId, kind: r.upload!.kind };
        if (!this.snapshot.completed.some((c) => c.takeId === done.takeId && c.kind === done.kind)) {
          this.update({ completed: [...this.snapshot.completed, done] });
        }
        await deleteRecording(r.id);
        this.registered.delete(r.id);
        this.urls.delete(r.id);
        recordings.splice(recordings.indexOf(r), 1);
        assembling.delete(r.id);
      } else if (answer.status === "assembling") {
        assembling.add(r.id);
      }
      publish();
    }
    return pending.length > 0;
  }

  private base(r: StoredRecording) {
    return `/api/record/tracks/${r.upload!.takeId}/${r.upload!.kind}`;
  }

  private async register(r: StoredRecording, again = false) {
    if (this.registered.has(r.id) && !again) return;
    const res = await fetch(`/api/record/tracks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        takeId: r.upload!.takeId,
        kind: r.upload!.kind,
        mimeType: r.mimeType,
        startedAt: new Date(r.startedAt).toISOString(),
        offsetMs: r.upload!.offsetMs,
        contributor: r.upload!.contributor ?? "",
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    // 403: the take is another account's — recorded here by someone else, now signed in as someone new.
    if (res.status === 403) throw new Gone();
    if (!res.ok) throw answered(res);
    const body = (await res.json().catch(() => ({}))) as { upload?: "direct" | "app" };
    this.registered.set(r.id, body.upload === "direct" ? "direct" : "app");
  }

  /**
   * A signed URL for chunk `seq`, asking for a batch from `seq` on when there
   * is none in hand. Workers wanting the same stream's URLs share one request.
   */
  private async uploadUrl(r: StoredRecording, seq: number): Promise<string | null> {
    if (this.finished.has(r.id)) return null;
    const held = this.urls.get(r.id)?.get(seq);
    if (held && held.until > Date.now()) return held.url;
    const pending = this.asking.get(r.id);
    if (pending) {
      await pending;
      return this.uploadUrl(r, seq);
    }
    const ask = (async () => {
      const seqs = Array.from({ length: UPLOAD_URL_BATCH }, (_, i) => seq + i);
      const res = await fetch(`${this.base(r)}/upload-urls`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seqs }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (res.status === 404) {
        this.registered.delete(r.id);
        await this.register(r, true);
        throw new Error("the server lost track of the recording");
      }
      // 409: the file is already joined, so every chunk of it is in.
      if (res.status === 409) {
        this.finished.add(r.id);
        return;
      }
      if (!res.ok) throw answered(res);
      const { urls } = (await res.json()) as { urls: Record<string, string> };
      // Signed for an hour; used well inside it, so a slow chunk never starts on a URL about to lapse.
      const until = Date.now() + URL_REUSE_MS;
      const mine = this.urls.get(r.id) ?? new Map<number, { url: string; until: number }>();
      for (const [n, url] of Object.entries(urls)) mine.set(Number(n), { url, until });
      this.urls.set(r.id, mine);
    })();
    this.asking.set(r.id, ask);
    try {
      await ask;
    } finally {
      this.asking.delete(r.id);
    }
    if (this.finished.has(r.id)) return null;
    const got = this.urls.get(r.id)?.get(seq);
    if (!got) throw new Error("the server sent no upload address");
    return got.url;
  }

  private async sendChunk(r: StoredRecording, seq: number) {
    const data = await readChunk(r.id, seq);
    const url = data && this.registered.get(r.id) === "direct" ? await this.uploadUrl(r, seq) : undefined;
    if (url) {
      const res = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream" },
        body: data,
        signal: AbortSignal.timeout(CHUNK_TIMEOUT_MS),
      });
      if (!res.ok) {
        // An expired or refused URL is never tried twice: the next attempt asks for a fresh one.
        this.urls.get(r.id)?.delete(seq);
        throw new Error(`the storage service answered ${res.status}`);
      }
    } else if (data && url === undefined) {
      const res = await fetch(`${this.base(r)}/chunks/${seq}`, {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream" },
        body: data,
        signal: AbortSignal.timeout(CHUNK_TIMEOUT_MS),
      });
      if (res.status === 404) {
        // The stream is not filed after all, as after a server restore: file it and send this again.
        this.registered.delete(r.id);
        await this.register(r, true);
        throw new Error("the server lost track of the recording");
      }
      // 409: the file is already joined, so the server has this chunk.
      if (!res.ok && res.status !== 409) throw answered(res);
    }
    await markUploaded(r.id, seq);
  }

  private async finish(
    r: StoredRecording,
    chunks: number,
  ): Promise<{ status: "missing"; missing: number[] } | { status: "assembling" | "ready" | "failed" }> {
    const res = await fetch(`${this.base(r)}/finish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chunks, durationMs: Math.round(r.durationMs) }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (res.status === 404) throw new Gone();
    if (!res.ok) throw answered(res);
    return res.json();
  }
}

function describe(err: unknown): string {
  if (err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError")) return "the connection is too slow";
  if (err instanceof TypeError) return "the connection dropped";
  return (err as Error)?.message || "something went wrong";
}
