"use client";

/**
 * A live transcript of a microphone stream, from Deepgram, while it records.
 *
 * Runs its own MediaRecorder on the same stream, a quarter-second at a time,
 * so the saved recording is untouched by anything that happens here: a socket
 * that fails to open costs the live transcript, never the audio. The browser
 * never sees the API key; it gets a short-lived token from
 * /api/transcription/token and opens the socket itself.
 *
 * When the stream ends — the recording stopped, or the microphone closed — it
 * asks Deepgram to finish, so the last words arrive as final results before
 * the socket closes.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { pickMimeType } from "@/lib/recording/format";
import { liveListenUrl, parseLiveMessage } from "@/lib/recording/deepgram";

/** Small enough that words appear as they are said. */
const LIVE_CHUNK_MS = 250;
/** How long to wait for the last results after asking Deepgram to finish. */
const FINISH_TIMEOUT_MS = 5_000;

export type LiveTranscriptStatus =
  | "idle"
  | "connecting"
  | "live"
  | "finishing"
  | "done"
  /** This deployment has no Deepgram key. */
  | "unavailable"
  | "failed";

export type LiveTranscript = {
  status: LiveTranscriptStatus;
  /** Settled text, segment by segment. */
  finals: string[];
  /** What Deepgram is still revising. */
  interim: string;
  error: string | null;
};

const EMPTY: LiveTranscript = { status: "idle", finals: [], interim: "", error: null };

export function useLiveTranscript(stream: MediaStream | null) {
  const [live, setLive] = useState<LiveTranscript>(EMPTY);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!stream) return;
    let socket: WebSocket | null = null;
    let recorder: MediaRecorder | null = null;
    let finishTimer: ReturnType<typeof setTimeout> | undefined;
    let ended = false;

    const finish = () => {
      if (!socket || socket.readyState !== WebSocket.OPEN) return;
      socket.send(JSON.stringify({ type: "CloseStream" }));
      setLive((l) => (l.status === "live" ? { ...l, status: "finishing" } : l));
      const s = socket;
      finishTimer = setTimeout(() => s.close(), FINISH_TIMEOUT_MS);
    };

    void (async () => {
      const res = await fetch("/api/transcription/token", { method: "POST" }).catch(() => null);
      if (!res || !res.ok) {
        const body = (await res?.json().catch(() => null)) as { error?: string } | null;
        setLive({
          ...EMPTY,
          status: body?.error === "unconfigured" ? "unavailable" : "failed",
          error: body?.error === "unconfigured" ? null : "Live transcription could not start.",
        });
        return;
      }
      const { token } = (await res.json()) as { token: string };
      if (ended) {
        setLive((l) => ({ ...l, status: "done" }));
        return;
      }

      socket = new WebSocket(liveListenUrl(), ["bearer", token]);
      socketRef.current = socket;
      socket.onopen = () => {
        if (ended) return finish();
        const mimeType = pickMimeType((t) => MediaRecorder.isTypeSupported(t)) ?? undefined;
        recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0 && socket?.readyState === WebSocket.OPEN) socket.send(e.data);
        };
        // The stream's tracks ending stops this recorder too; its last chunk
        // is sent first, then Deepgram is asked to finish.
        recorder.onstop = finish;
        recorder.start(LIVE_CHUNK_MS);
        setLive((l) => ({ ...l, status: "live" }));
      };
      socket.onmessage = (e) => {
        const result = parseLiveMessage(e.data);
        if (!result) return;
        setLive((l) =>
          result.isFinal
            ? { ...l, finals: result.text ? [...l.finals, result.text] : l.finals, interim: "" }
            : { ...l, interim: result.text },
        );
      };
      socket.onerror = () => {
        setLive((l) => ({ ...l, status: "failed", error: "The live transcript lost its connection." }));
      };
      socket.onclose = () => {
        clearTimeout(finishTimer);
        if (socketRef.current === socket) socketRef.current = null;
        setLive((l) =>
          l.status === "failed" ? l : { ...l, status: "done", finals: l.interim ? [...l.finals, l.interim] : l.finals, interim: "" },
        );
      };
    })();

    return () => {
      ended = true;
      if (recorder && recorder.state !== "inactive") recorder.stop();
      else finish();
    };
  }, [stream]);

  // Leaving the page drops the socket outright.
  useEffect(() => () => socketRef.current?.close(), []);

  /** Clears the last transcript; call just before the stream it should follow starts. */
  const begin = useCallback(() => setLive({ ...EMPTY, status: "connecting" }), []);

  /** Clears the last transcript without starting another. */
  const clear = useCallback(() => setLive(EMPTY), []);

  return { ...live, begin, clear };
}
