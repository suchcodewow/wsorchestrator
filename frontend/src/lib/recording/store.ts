/**
 * Recordings kept in this browser's IndexedDB, so a judge's audio survives a
 * dropped connection, a reload or a crashed tab. Nothing here is sent
 * anywhere.
 *
 * A recording is written a second at a time as the recorder hands chunks
 * over. Each chunk and the recording's running length go in one transaction,
 * so what is on disk is always a playable recording up to its last chunk —
 * there is no "finish" step a crash could skip. A recording still marked
 * `recording` that has not grown for `STALE_MS` was cut off; it lists as
 * `interrupted` and plays like any other.
 *
 * IndexedDB belongs to the site, not the account, so every recording carries
 * its owner and is only ever listed for them.
 *
 * A recording with an `upload` target is one stream of an async recording
 * take, and is sent to the server a chunk at a time by
 * `lib/recording/uploader.ts`. Which chunks have landed is kept beside the
 * chunks, so a reload or a crash resumes the upload where it stopped; once
 * the server has the whole stream, the recording is deleted from here.
 */

const DB_NAME = "workshop-orchestrator-recordings";
const DB_VERSION = 2;
const RECORDINGS = "recordings";
const CHUNKS = "chunks";
/** Since version 2: `[recordingId, seq]` of each chunk the server has confirmed. */
const UPLOADED = "uploaded";

/** Several chunk intervals: long enough that a busy tab is not mistaken for a dead one. */
const STALE_MS = 10_000;

export type RecordingStatus = "recording" | "stopped" | "interrupted";

export type StoredRecording = {
  id: string;
  ownerId: string;
  /** What it is a recording of: `check-pc`, or an attendee on an assessment. */
  subject: string;
  /** How it reads in a list, and the start of its download's file name. */
  label: string;
  mimeType: string;
  startedAt: number;
  /** When the last chunk landed. */
  updatedAt: number;
  durationMs: number;
  bytes: number;
  chunks: number;
  status: RecordingStatus;
  /** Where an async recording's stream goes; absent for a recording kept only here. */
  upload?: UploadTarget;
};

export type UploadTarget = {
  takeId: string;
  kind: "camera" | "screen";
  /** When this stream started after the take's first one. */
  offsetMs: number;
  /** The name the person recording gave; absent on a take recorded before the page asked. */
  contributor?: string;
};

type StoredChunk = { recordingId: string; seq: number; data: ArrayBuffer };

/** The subject an attendee's recordings on one assessment are filed under. */
export const evalSubject = (assessmentId: string, employeeId: string) =>
  `eval:${assessmentId}:${employeeId}`;

export const CHECK_PC_SUBJECT = "check-pc";

/** The subject an async recording's streams are filed under, beside an eVals subject or Check PC's. */
export const RECORDING_SUBJECT = "async-recording";

export function recordingsSupported(): boolean {
  return typeof indexedDB !== "undefined";
}

let opening: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = req.result;
      if (event.oldVersion < 1) {
        const recordings = db.createObjectStore(RECORDINGS, { keyPath: "id" });
        recordings.createIndex("owner_subject", ["ownerId", "subject"]);
        recordings.createIndex("owner", "ownerId");
        const chunks = db.createObjectStore(CHUNKS, { keyPath: ["recordingId", "seq"] });
        chunks.createIndex("recording", "recordingId");
      }
      if (event.oldVersion < 2) {
        db.createObjectStore(UPLOADED, { keyPath: ["recordingId", "seq"] });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // Another tab upgrading the schema closes this one; open afresh next time.
      db.onversionchange = () => {
        db.close();
        opening = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      opening = null;
      reject(req.error);
    };
    req.onblocked = () => {
      opening = null;
      reject(new Error("The recordings store is open in an older tab. Close other tabs of this site and try again."));
    };
  });
  return opening;
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("The recording could not be saved."));
  });
}

function result<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Files a new, empty recording, before its first chunk arrives. */
export async function createRecording(
  fields: Pick<StoredRecording, "ownerId" | "subject" | "label" | "mimeType" | "upload">,
): Promise<StoredRecording> {
  const now = Date.now();
  const recording: StoredRecording = {
    ...fields,
    id: crypto.randomUUID(),
    startedAt: now,
    updatedAt: now,
    durationMs: 0,
    bytes: 0,
    chunks: 0,
    status: "recording",
  };
  const db = await open();
  const tx = db.transaction(RECORDINGS, "readwrite");
  tx.objectStore(RECORDINGS).add(recording);
  await done(tx);
  return recording;
}

/**
 * Adds chunk `seq` and moves the recording's length on to now, together.
 * `final` marks it stopped in the same write.
 */
export async function appendChunk(id: string, seq: number, data: Blob, final = false): Promise<void> {
  const buffer = await data.arrayBuffer();
  const db = await open();
  const tx = db.transaction([RECORDINGS, CHUNKS], "readwrite");
  const recordings = tx.objectStore(RECORDINGS);
  if (buffer.byteLength > 0) {
    tx.objectStore(CHUNKS).put({ recordingId: id, seq, data: buffer } satisfies StoredChunk);
  }
  const req = recordings.get(id);
  req.onsuccess = () => {
    const recording = req.result as StoredRecording | undefined;
    if (!recording) return;
    const now = Date.now();
    recordings.put({
      ...recording,
      updatedAt: now,
      durationMs: now - recording.startedAt,
      bytes: recording.bytes + buffer.byteLength,
      chunks: recording.chunks + (buffer.byteLength > 0 ? 1 : 0),
      status: final ? "stopped" : recording.status,
    } satisfies StoredRecording);
  };
  await done(tx);
}

/** Marks a recording stopped without adding audio, for a recorder that ended with nothing left to hand over. */
export async function markStopped(id: string): Promise<void> {
  const db = await open();
  const tx = db.transaction(RECORDINGS, "readwrite");
  const recordings = tx.objectStore(RECORDINGS);
  const req = recordings.get(id);
  req.onsuccess = () => {
    const recording = req.result as StoredRecording | undefined;
    if (recording && recording.status === "recording") recordings.put({ ...recording, status: "stopped" });
  };
  await done(tx);
}

function withStaleness(recording: StoredRecording, now: number): StoredRecording {
  return recording.status === "recording" && now - recording.updatedAt > STALE_MS
    ? { ...recording, status: "interrupted" }
    : recording;
}

/** `ownerId`'s recordings, newest first; only `subject`'s when given. */
export async function listRecordings(ownerId: string, subject?: string): Promise<StoredRecording[]> {
  const db = await open();
  const tx = db.transaction(RECORDINGS, "readonly");
  const store = tx.objectStore(RECORDINGS);
  const rows = (await result(
    subject === undefined
      ? store.index("owner").getAll(ownerId)
      : store.index("owner_subject").getAll([ownerId, subject]),
  )) as StoredRecording[];
  const now = Date.now();
  return rows.map((r) => withStaleness(r, now)).sort((a, b) => b.startedAt - a.startedAt);
}

/** One recording's details, without its audio; null if it is gone. */
export async function getRecording(id: string): Promise<StoredRecording | null> {
  const db = await open();
  const tx = db.transaction(RECORDINGS, "readonly");
  const recording = (await result(tx.objectStore(RECORDINGS).get(id))) as StoredRecording | undefined;
  return recording ? withStaleness(recording, Date.now()) : null;
}

/** The whole recording as one playable file, its chunks in order. */
export async function readRecording(id: string): Promise<Blob | null> {
  const db = await open();
  const tx = db.transaction([RECORDINGS, CHUNKS], "readonly");
  const recording = (await result(tx.objectStore(RECORDINGS).get(id))) as StoredRecording | undefined;
  if (!recording) return null;
  const range = IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]);
  const chunks = (await result(tx.objectStore(CHUNKS).getAll(range))) as StoredChunk[];
  return new Blob(
    chunks.map((c) => c.data),
    { type: recording.mimeType },
  );
}

export async function deleteRecording(id: string): Promise<void> {
  const db = await open();
  const tx = db.transaction([RECORDINGS, CHUNKS, UPLOADED], "readwrite");
  tx.objectStore(RECORDINGS).delete(id);
  tx.objectStore(CHUNKS).delete(chunkRange(id));
  tx.objectStore(UPLOADED).delete(chunkRange(id));
  await done(tx);
}

const chunkRange = (id: string) => IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]);

const seqsOf = (keys: IDBValidKey[]) => keys.map((k) => (k as [string, number])[1]);

/** `ownerId`'s recordings that are going to the server, oldest first, whether still recording or not. */
export async function listUploads(ownerId: string): Promise<StoredRecording[]> {
  const rows = await listRecordings(ownerId);
  return rows.filter((r) => r.upload).reverse();
}

/** Which chunks of a recording are kept here, and which of them the server has. */
export async function uploadProgress(id: string): Promise<{ kept: number[]; uploaded: Set<number> }> {
  const db = await open();
  const tx = db.transaction([CHUNKS, UPLOADED], "readonly");
  const [kept, uploaded] = await Promise.all([
    result(tx.objectStore(CHUNKS).getAllKeys(chunkRange(id))),
    result(tx.objectStore(UPLOADED).getAllKeys(chunkRange(id))),
  ]);
  return { kept: seqsOf(kept), uploaded: new Set(seqsOf(uploaded)) };
}

/** One chunk's bytes, or null if it is not kept. */
export async function readChunk(id: string, seq: number): Promise<ArrayBuffer | null> {
  const db = await open();
  const tx = db.transaction(CHUNKS, "readonly");
  const chunk = (await result(tx.objectStore(CHUNKS).get([id, seq]))) as StoredChunk | undefined;
  return chunk?.data ?? null;
}

export async function markUploaded(id: string, seq: number): Promise<void> {
  const db = await open();
  const tx = db.transaction(UPLOADED, "readwrite");
  tx.objectStore(UPLOADED).put({ recordingId: id, seq });
  await done(tx);
}

/** Forgets that the server had these chunks, for when it says it does not: they are sent again. */
export async function markNotUploaded(id: string, seqs: number[]): Promise<void> {
  const db = await open();
  const tx = db.transaction(UPLOADED, "readwrite");
  for (const seq of seqs) tx.objectStore(UPLOADED).delete([id, seq]);
  await done(tx);
}

export type StorageStatus = {
  /** Whether the browser has promised not to clear this site's data to free space. */
  persisted: boolean | null;
  usage: number | null;
  quota: number | null;
};

export async function storageStatus(): Promise<StorageStatus> {
  const storage = typeof navigator !== "undefined" ? navigator.storage : undefined;
  const [persisted, estimate] = await Promise.all([
    storage?.persisted?.().catch(() => null) ?? null,
    storage?.estimate?.().catch(() => null) ?? null,
  ]);
  return { persisted, usage: estimate?.usage ?? null, quota: estimate?.quota ?? null };
}

/**
 * Asks the browser to keep this site's data when the disk fills. Chrome
 * decides by itself — it says yes to a site you use often or have installed —
 * and Firefox asks the user; either way a "no" only means the data is evictable
 * under pressure, not that it is gone.
 */
export async function requestPersistence(): Promise<boolean> {
  return (await navigator.storage?.persist?.().catch(() => false)) ?? false;
}
