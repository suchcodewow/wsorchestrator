/**
 * Deepgram speech-to-text: the URLs both halves call, and the shapes of what
 * comes back. Shared by the browser (the live socket) and the server (the
 * token grant and the full-recording transcript), so nothing here is secret.
 *
 * Every listen URL carries `mip_opt_out=true`. Deepgram has no account setting
 * for it: a request without the flag lets them keep the audio and transcript
 * to train their models, so the flag is set here, once, and never per caller.
 */

const HOST = "api.deepgram.com";
export const DEEPGRAM_MODEL = "nova-3";

/** How long a browser's token lasts. It need only be valid while the socket opens. */
export const TOKEN_TTL_SECONDS = 60;

/** The largest recording the full transcript accepts; Cloud Run refuses bodies past 32 MB. */
export const MAX_TRANSCRIBE_BYTES = 25 * 1024 * 1024;

export const GRANT_URL = `https://${HOST}/v1/auth/grant`;

function listenQuery(extra: Record<string, string>): string {
  return new URLSearchParams({
    model: DEEPGRAM_MODEL,
    smart_format: "true",
    ...extra,
    mip_opt_out: "true",
  }).toString();
}

/** The streaming socket. MediaRecorder's chunks are containerized, so no encoding is named. */
export function liveListenUrl(): string {
  return `wss://${HOST}/v1/listen?${listenQuery({ interim_results: "true" })}`;
}

/** One request with the whole recording as its body. */
export function prerecordedListenUrl(): string {
  return `https://${HOST}/v1/listen?${listenQuery({})}`;
}

/** What one message on the live socket adds, or null for anything that isn't a transcript. */
export type LiveResult = { text: string; isFinal: boolean };

export function parseLiveMessage(data: unknown): LiveResult | null {
  if (typeof data !== "string") return null;
  let msg: unknown;
  try {
    msg = JSON.parse(data);
  } catch {
    return null;
  }
  if (!msg || typeof msg !== "object") return null;
  const m = msg as { type?: unknown; is_final?: unknown; channel?: { alternatives?: { transcript?: unknown }[] } };
  if (m.type !== "Results") return null;
  const text = m.channel?.alternatives?.[0]?.transcript;
  if (typeof text !== "string") return null;
  return { text, isFinal: m.is_final === true };
}

/** The transcript in a pre-recorded response, or "" when Deepgram heard nothing. */
export function prerecordedTranscript(body: unknown): string {
  const t = (body as { results?: { channels?: { alternatives?: { transcript?: unknown }[] }[] } } | null)
    ?.results?.channels?.[0]?.alternatives?.[0]?.transcript;
  return typeof t === "string" ? t : "";
}
