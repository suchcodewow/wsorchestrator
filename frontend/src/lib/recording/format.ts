/**
 * The parts of recording that need no browser: which container to record in,
 * what a microphone failure means, and how a recording's length and size read.
 * Everything that touches `MediaRecorder` or IndexedDB builds on these.
 */

/**
 * Opus first: Chrome, Edge and Firefox record it, and it is what speech
 * services take without converting. Safari records only MP4.
 */
export const RECORDING_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/ogg;codecs=opus",
  "audio/webm",
  "audio/mp4",
] as const;

/** Speech at 32 kbit/s is about 14 MB an hour, well under what a browser lets a site keep. */
export const RECORDING_BITS_PER_SECOND = 32_000;

/** How often the recorder hands over audio, and so the most a crashed tab can lose. */
export const RECORDING_CHUNK_MS = 1_000;

/** The first container `isTypeSupported` accepts, or null when the browser records none of them. */
export function pickMimeType(isTypeSupported: (type: string) => boolean): string | null {
  return RECORDING_MIME_TYPES.find((type) => isTypeSupported(type)) ?? null;
}

/** The file extension a download of `mimeType` should carry. */
export function extensionFor(mimeType: string): string {
  const base = mimeType.split(";")[0]!.trim();
  if (base === "audio/mp4") return "m4a";
  if (base === "audio/ogg") return "ogg";
  return "webm";
}

/** `0:07`, `12:30`, `1:02:03`. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** `850 KB`, `14.2 MB`. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export type MicrophoneProblem =
  /** The site, or the browser's own settings, refused. */
  | "blocked"
  /** The operating system refused the browser itself (macOS Privacy & Security). */
  | "blocked_by_system"
  | "no_microphone"
  /** Another app holds it, or the hardware failed. */
  | "in_use"
  /** The saved microphone is gone: unplugged, or a different computer. */
  | "device_gone"
  /** Not HTTPS, or a browser with no `getUserMedia`. */
  | "unsupported"
  | "unknown";

/**
 * What a `getUserMedia` rejection means. Chrome reports a macOS-level refusal
 * as `NotAllowedError` with "system" in the message, which needs a different
 * fix — System Settings, then restarting the browser — from a site-level one.
 */
export function microphoneProblem(error: unknown): MicrophoneProblem {
  const name = (error as { name?: unknown } | null)?.name;
  const message = String((error as { message?: unknown } | null)?.message ?? "");
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return /system/i.test(message) ? "blocked_by_system" : "blocked";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "no_microphone";
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

export const MICROPHONE_PROBLEM_MESSAGES: Record<MicrophoneProblem, string> = {
  blocked:
    "The browser is blocking the microphone for this site. Click the icon at the left of the address bar, set Microphone to Allow, then reload.",
  blocked_by_system:
    "Your computer is blocking the browser from the microphone. On a Mac: System Settings → Privacy & Security → Microphone, turn your browser on, then quit and reopen it.",
  no_microphone: "No microphone was found. Plug one in, or check that the built-in one is enabled.",
  in_use: "The microphone could not be started. Another app may be using it — close it and try again.",
  device_gone: "The chosen microphone is no longer connected. Pick another one.",
  unsupported: "This browser cannot record here. Use a current Chrome, Edge, Firefox or Safari.",
  unknown: "The microphone could not be started.",
};
