"use client";

/**
 * Records the microphone into this browser's recordings store, a second at a
 * time, until stopped.
 *
 * `stop()` resolves only once the last chunk is on disk, so a caller that
 * awaits it — the scoring form's Submit — knows the audio is safe before it
 * moves on. Unmounting stops the recording too: leaving the page cannot leave
 * the microphone on, and what was recorded up to then is kept. Closing or
 * reloading the tab mid-recording asks first.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  MICROPHONE_PROBLEM_MESSAGES,
  RECORDING_BITS_PER_SECOND,
  RECORDING_CHUNK_MS,
  pickMimeType,
} from "@/lib/recording/format";
import { closeMicrophone, openMicrophone } from "@/lib/recording/microphone";
import { appendChunk, createRecording, markStopped } from "@/lib/recording/store";

export type RecorderState = "idle" | "starting" | "recording" | "stopping";

type Session = {
  recorder: MediaRecorder;
  stream: MediaStream;
  recordingId: string;
  startedAt: number;
  /** Every write so far, in order: each chunk waits for the one before it. */
  writes: Promise<void>;
  stopped: Promise<void>;
};

export function useRecorder({
  ownerId,
  subject,
  label,
  onSaved,
}: {
  ownerId: string;
  subject: string;
  label: string;
  /** After a recording's last chunk is written: refresh whatever lists them. */
  onSaved?: (recordingId: string) => void;
}) {
  const [state, setState] = useState<RecorderState>("idle");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const session = useRef<Session | null>(null);
  const onSavedRef = useRef(onSaved);

  useEffect(() => {
    onSavedRef.current = onSaved;
  }, [onSaved]);

  const stop = useCallback(async (): Promise<void> => {
    const current = session.current;
    if (!current) return;
    setState("stopping");
    if (current.recorder.state !== "inactive") current.recorder.stop();
    await current.stopped;
  }, []);

  const start = useCallback(async () => {
    if (session.current) return;
    setError(null);
    setState("starting");

    const mic = await openMicrophone();
    if (!mic.ok) {
      setError(MICROPHONE_PROBLEM_MESSAGES[mic.problem]);
      setState("idle");
      return;
    }
    const mimeType = pickMimeType((t) => MediaRecorder.isTypeSupported(t));
    if (!mimeType) {
      closeMicrophone(mic.stream);
      setError(MICROPHONE_PROBLEM_MESSAGES.unsupported);
      setState("idle");
      return;
    }

    let recordingId: string;
    try {
      recordingId = (await createRecording({ ownerId, subject, label, mimeType })).id;
    } catch (e) {
      closeMicrophone(mic.stream);
      setError(`This browser would not save the recording: ${(e as Error)?.message ?? "storage is unavailable"}.`);
      setState("idle");
      return;
    }

    const recorder = new MediaRecorder(mic.stream, { mimeType, audioBitsPerSecond: RECORDING_BITS_PER_SECOND });
    let seq = 0;
    let resolveStopped!: () => void;
    const current: Session = {
      recorder,
      stream: mic.stream,
      recordingId,
      startedAt: Date.now(),
      writes: Promise.resolve(),
      stopped: new Promise<void>((resolve) => (resolveStopped = resolve)),
    };

    const write = (job: () => Promise<void>) => {
      current.writes = current.writes.then(job).catch((e: unknown) => {
        setError(`Part of the recording could not be saved: ${(e as Error)?.message ?? "storage is full"}.`);
      });
    };

    recorder.ondataavailable = (e) => {
      const n = seq++;
      write(() => appendChunk(recordingId, n, e.data));
    };
    recorder.onstop = () => {
      write(() => markStopped(recordingId));
      closeMicrophone(mic.stream);
      void current.writes.then(() => {
        session.current = null;
        setStream(null);
        setStartedAt(null);
        setState("idle");
        onSavedRef.current?.(recordingId);
        resolveStopped();
      });
    };
    recorder.onerror = () => {
      setError("The recorder failed. What was recorded up to now is saved.");
      if (recorder.state !== "inactive") recorder.stop();
    };
    for (const track of mic.stream.getAudioTracks()) {
      track.onended = () => {
        setError("The microphone was disconnected, so recording stopped. What was recorded is saved.");
        if (recorder.state !== "inactive") recorder.stop();
      };
    }

    session.current = current;
    recorder.start(RECORDING_CHUNK_MS);
    setStream(mic.stream);
    setStartedAt(current.startedAt);
    setNow(current.startedAt);
    setState("recording");
  }, [ownerId, subject, label]);

  useEffect(() => {
    if (state !== "recording") return;
    const tick = setInterval(() => setNow(Date.now()), 250);
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => {
      clearInterval(tick);
      window.removeEventListener("beforeunload", warn);
    };
  }, [state]);

  // Leaving the page stops the recording; its chunks are already saved.
  useEffect(
    () => () => {
      const current = session.current;
      if (current && current.recorder.state !== "inactive") current.recorder.stop();
    },
    [],
  );

  return {
    state,
    stream,
    elapsedMs: startedAt === null ? 0 : now - startedAt,
    error,
    start,
    stop,
    recording: state === "recording" || state === "stopping",
  };
}
