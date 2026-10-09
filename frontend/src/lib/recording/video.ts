/**
 * The parts of an async video recording that need no browser: which container
 * each stream records in, how hard to encode it, and which chunks the server
 * still lacks. The recorder, the uploader and the API routes share these.
 *
 * A recording is two files, never one composited video: the camera with the
 * microphone, and the shared screen with whatever audio the browser shares
 * with it. That is the whole point of it — an editor gets both at full
 * quality, to cut between and lay out as they like.
 */

import type { RecordingTrackKind } from "@/db/schema";

/**
 * H.264 in MP4 first: Chrome and Edge record it from 126 on, Safari records
 * nothing else, and every editor opens it without converting. Firefox records
 * only WebM. High profile at level 5.1 so a 1440p screen at 60 fps still fits; the bare
 * `avc1` lets the browser choose where it rejects a profile it cannot encode.
 */
const MP4_VIDEO = ["avc1.640033", "avc1.640028", "avc1"];

export const VIDEO_MIME_TYPES = {
  withAudio: [
    ...MP4_VIDEO.map((v) => `video/mp4;codecs=${v},mp4a.40.2`),
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ],
  videoOnly: [
    ...MP4_VIDEO.map((v) => `video/mp4;codecs=${v}`),
    "video/mp4",
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ],
} as const;

/**
 * Bits a second to encode each stream at. Well above what a call sends, which
 * is the reason to record locally: nothing here depends on the connection.
 * 12 Mbit/s for a 1080p30 camera keeps the texture of skin and hair that
 * 6 loses, and side by side 20 looked no better from a laptop webcam: past
 * this the bits mostly keep sensor noise. The screen gets as much because it
 * may run at 60 frames a second. An hour is at most about 5.4 GB of each; a
 * mostly still screen is far less, since the encoder spends bits only on what
 * changes.
 */
export const VIDEO_BITS_PER_SECOND: Record<RecordingTrackKind, number> = {
  camera: 12_000_000,
  screen: 12_000_000,
};

export const VIDEO_AUDIO_BITS_PER_SECOND = 128_000;

/**
 * How often each recorder hands over a chunk: what one upload carries, about
 * 2 MB, and the most a crashed tab can lose. Small enough to get through a
 * poor connection in one try; large enough that an hour is not 10,000 requests.
 */
export const VIDEO_CHUNK_MS = 2_000;

/**
 * The largest piece a chunk is stored and uploaded as. Chrome's MP4 recorder
 * only hands over data at a keyframe, so a chunk can be far bigger than two
 * seconds' worth; it is cut into pieces of at most this, each with its own
 * sequence number. The pieces are byte ranges of one stream, so the server
 * joins them like any other chunks. Well under the 10 MB Next.js reads of a
 * request body, past which it silently drops the rest.
 */
export const VIDEO_PIECE_BYTES = 4 * 1024 * 1024;

/** `[start, end)` byte ranges cutting `size` bytes into pieces of at most `max`. */
export function pieceRanges(size: number, max: number = VIDEO_PIECE_BYTES): [number, number][] {
  const ranges: [number, number][] = [];
  for (let start = 0; start < size; start += max) ranges.push([start, Math.min(size, start + max)]);
  return ranges;
}

/**
 * How long a stream can go without a chunk arriving, while not finished,
 * before it counts as stalled: the participant most likely closed the page
 * or lost their connection, and the sender should ask them to reopen the link.
 * Several chunk intervals, and longer than a retry's longest wait.
 */
export const UPLOAD_STALLED_MS = 2 * 60_000;

/**
 * How long a recording is kept: it is deleted this many days after it was
 * made. The bucket's lifecycle rule (`recordings_retention_days` in
 * `infra/admin/recordings.tf`) deletes the files on the same schedule, so the
 * two must agree.
 */
export const RECORDING_RETENTION_DAYS = 90;

/** The day a recording made at `startedAt` is deleted. */
export function deletesOn(startedAt: string): Date {
  return new Date(new Date(startedAt).getTime() + RECORDING_RETENTION_DAYS * 24 * 60 * 60_000);
}

/**
 * How many chunks' upload URLs the browser asks for at once, ahead of the
 * chunks themselves. Each request is an audited action, so this is what keeps
 * the audit trail at a few dozen rows a recording rather than one a chunk:
 * about 50 seconds of a stream per request.
 */
export const UPLOAD_URL_BATCH = 25;

/** The first container `isTypeSupported` accepts for a stream with or without sound, or null. */
export function pickVideoMimeType(isTypeSupported: (type: string) => boolean, withAudio: boolean): string | null {
  const types = withAudio ? VIDEO_MIME_TYPES.withAudio : VIDEO_MIME_TYPES.videoOnly;
  return types.find((type) => isTypeSupported(type)) ?? null;
}

/** The file extension a stream recorded as `mimeType` is served with. */
export function videoExtensionFor(mimeType: string): "mp4" | "webm" {
  return mimeType.split(";")[0]!.trim() === "video/mp4" ? "mp4" : "webm";
}

/** The MIME type a finished file is served as, without its codecs. */
export function videoContentType(mimeType: string): string {
  return videoExtensionFor(mimeType) === "mp4" ? "video/mp4" : "video/webm";
}

/** Every sequence number below `total` that is not in `received`, in order. */
export function missingChunks(received: Iterable<number>, total: number): number[] {
  const have = new Set(received);
  const missing: number[] = [];
  for (let seq = 0; seq < total; seq++) if (!have.has(seq)) missing.push(seq);
  return missing;
}

/**
 * How long to wait before upload attempt `attempt` (0-based) after a failure:
 * doubling from one second to half a minute, with jitter so a room full of
 * people whose Wi-Fi came back at once do not all retry together.
 */
export function retryDelayMs(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(30_000, 1_000 * 2 ** Math.max(0, attempt));
  return Math.round(base * (0.75 + random() * 0.5));
}

/** `Dana Smith - 2026-10-09 15-43 UTC - screen.mp4`, safe on every filesystem. */
export function trackFileName(input: {
  contributor: string;
  startedAt: Date;
  kind: RecordingTrackKind;
  mimeType: string;
}): string {
  const at = input.startedAt.toISOString();
  const stamp = `${at.slice(0, 10)} ${at.slice(11, 13)}-${at.slice(14, 16)} UTC`;
  const parts = [input.contributor || "Recording", stamp, input.kind]
    .map((p) => p.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return `${parts.join(" - ")}.${videoExtensionFor(input.mimeType)}`;
}

export type CameraProblem =
  | "blocked"
  | "blocked_by_system"
  | "no_camera"
  | "in_use"
  | "device_gone"
  | "unsupported"
  | "unknown";

/** What a `getUserMedia` rejection for the camera means; the same names as the microphone's. */
export function cameraProblem(error: unknown): CameraProblem {
  const name = (error as { name?: unknown } | null)?.name;
  const message = String((error as { message?: unknown } | null)?.message ?? "");
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return /system/i.test(message) ? "blocked_by_system" : "blocked";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "no_camera";
    case "NotReadableError":
    case "TrackStartError":
    case "AbortError":
      return "in_use";
    case "OverconstrainedError":
      return "device_gone";
    case "SecurityError":
    case "TypeError":
      return "unsupported";
    default:
      return "unknown";
  }
}

export const CAMERA_PROBLEM_MESSAGES: Record<CameraProblem, string> = {
  blocked:
    "The browser is blocking the camera or microphone for this site. Click the icon at the left of the address bar, allow both, then reload.",
  blocked_by_system:
    "Your computer is blocking the browser from the camera or microphone. On a Mac: System Settings → Privacy & Security → Camera (and Microphone), turn your browser on, then quit and reopen it.",
  no_camera: "No camera or microphone was found. Plug one in, or check that the built-in one is enabled.",
  in_use: "The camera could not be started. Another app may be using it — close it and try again.",
  device_gone: "The chosen camera or microphone is no longer connected. Pick another one.",
  unsupported: "This browser cannot record here. Use a current Chrome or Edge on a computer.",
  unknown: "The camera could not be started.",
};

/**
 * Why sharing the screen did not start. Cancelling the browser's picker is a
 * `NotAllowedError` too, and is not a problem worth a red message.
 */
export function screenProblem(error: unknown): "cancelled" | "blocked_by_system" | "unsupported" | "unknown" {
  const name = (error as { name?: unknown } | null)?.name;
  const message = String((error as { message?: unknown } | null)?.message ?? "");
  if (name === "NotAllowedError") return /system/i.test(message) ? "blocked_by_system" : "cancelled";
  if (name === "NotSupportedError" || name === "TypeError") return "unsupported";
  return "unknown";
}

export const SCREEN_PROBLEM_MESSAGES = {
  cancelled: null,
  blocked_by_system:
    "Your computer is blocking the browser from sharing the screen. On a Mac: System Settings → Privacy & Security → Screen & System Audio Recording, turn your browser on, then quit and reopen it.",
  unsupported: "This browser cannot share a screen. Use a current Chrome or Edge on a computer.",
  unknown: "The screen could not be shared.",
} as const;
