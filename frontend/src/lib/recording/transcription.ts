/**
 * The server half of Deepgram: the key never leaves here. A browser that wants
 * a live transcript gets a short-lived token from grantToken() and opens the
 * socket itself; a finished recording is sent through transcribe().
 *
 * The key comes from the deployment — `deepgram_api_key` on the IaCM
 * workspace, which reaches Cloud Run as `DEEPGRAM_API_KEY` — or from `.env`
 * locally. Unset, both return `unconfigured` and the page goes on without a
 * transcript.
 */

import "server-only";
import {
  GRANT_URL,
  TOKEN_TTL_SECONDS,
  prerecordedListenUrl,
  prerecordedTranscript,
} from "./deepgram";

type Failure = { error: "unconfigured" | "upstream"; detail?: string };

function apiKey(): string | null {
  return process.env.DEEPGRAM_API_KEY?.trim() || null;
}

export function transcriptionConfigured(): boolean {
  return apiKey() !== null;
}

async function upstreamDetail(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  return `${res.status} ${text.slice(0, 200)}`.trim();
}

/** A token the browser opens one live socket with. */
export async function grantToken(): Promise<{ token: string; expiresIn: number } | Failure> {
  const key = apiKey();
  if (!key) return { error: "unconfigured" };
  try {
    const res = await fetch(GRANT_URL, {
      method: "POST",
      headers: { Authorization: `Token ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ttl_seconds: TOKEN_TTL_SECONDS }),
    });
    if (!res.ok) return { error: "upstream", detail: await upstreamDetail(res) };
    const body = (await res.json()) as { access_token?: unknown; expires_in?: unknown };
    if (typeof body.access_token !== "string") return { error: "upstream", detail: "no access_token" };
    return {
      token: body.access_token,
      expiresIn: typeof body.expires_in === "number" ? body.expires_in : TOKEN_TTL_SECONDS,
    };
  } catch (err) {
    return { error: "upstream", detail: err instanceof Error ? err.message : String(err) };
  }
}

/** The transcript of a whole recording, in one request. */
export async function transcribe(audio: Blob): Promise<{ transcript: string } | Failure> {
  const key = apiKey();
  if (!key) return { error: "unconfigured" };
  try {
    const res = await fetch(prerecordedListenUrl(), {
      method: "POST",
      headers: {
        Authorization: `Token ${key}`,
        // "audio/webm;codecs=opus" -> "audio/webm"; Deepgram reads the container.
        "Content-Type": audio.type.split(";")[0] || "application/octet-stream",
      },
      body: audio,
    });
    if (!res.ok) return { error: "upstream", detail: await upstreamDetail(res) };
    return { transcript: prerecordedTranscript(await res.json()) };
  } catch (err) {
    return { error: "upstream", detail: err instanceof Error ? err.message : String(err) };
  }
}
