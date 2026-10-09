"use client";

/**
 * Records one take of an async recording: the camera (with the microphone)
 * and, when one is shared, the screen, as separate recorders writing separate
 * recordings into this browser's store, a couple of seconds at a time.
 *
 * The recorders start together. Each stream is filed only once its recorder
 * has actually started, so the gap between them is known and goes to the
 * server as each one's offset, to line the files up. The uploader is poked
 * after every chunk; it is what sends them, and this never waits on the
 * network.
 *
 * The camera is the take: it ends when Stop is pressed, when the camera goes
 * away or when the page unmounts. Screen sharing stopping on its own — the
 * browser's "Stop sharing" bar — ends only the screen's file, and the camera
 * carries on. What was recorded is kept and uploaded either way.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { RECORDING_SUBJECT, appendChunk, createRecording, markStopped, requestPersistence } from "@/lib/recording/store";
import {
  VIDEO_AUDIO_BITS_PER_SECOND,
  VIDEO_BITS_PER_SECOND,
  VIDEO_CHUNK_MS,
  pickVideoMimeType,
  pieceRanges,
} from "@/lib/recording/video";

export type TakeState = "idle" | "starting" | "recording" | "stopping";

type Kind = "camera" | "screen";

type Take = {
  recorders: Partial<Record<Kind, MediaRecorder>>;
  startedAt: number;
  stopped: Promise<void>;
};

const START_TIMEOUT_MS = 5_000;

export function useTakeRecorder({
  ownerId,
  onChunk,
}: {
  ownerId: string;
  /** After each chunk is on disk, and when a take ends: the uploader looks again. */
  onChunk: () => void;
}) {
  const [state, setState] = useState<TakeState>("idle");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  /** Something worth saying that is not a failure: screen sharing stopped, the camera carries on. */
  const [notice, setNotice] = useState<string | null>(null);
  const [screenRecording, setScreenRecording] = useState(false);
  const take = useRef<Take | null>(null);
  const onChunkRef = useRef(onChunk);

  useEffect(() => {
    onChunkRef.current = onChunk;
  }, [onChunk]);

  const stop = useCallback(async (reason?: string): Promise<void> => {
    const current = take.current;
    if (!current) return;
    if (reason) setError(reason);
    setState("stopping");
    for (const r of Object.values(current.recorders)) if (r.state !== "inactive") r.stop();
    await current.stopped;
  }, []);

  const start = useCallback(
    async (camera: MediaStream, screen: MediaStream | null, contributor: string): Promise<boolean> => {
      if (take.current) return false;
      setError(null);
      setNotice(null);
      setState("starting");

      const streams: Partial<Record<Kind, MediaStream>> = screen ? { camera, screen } : { camera };
      const kinds = Object.keys(streams) as Kind[];
      const supported = (t: string) => MediaRecorder.isTypeSupported(t);
      const mimeTypes = Object.fromEntries(
        kinds.map((kind) => [kind, pickVideoMimeType(supported, streams[kind]!.getAudioTracks().length > 0)]),
      ) as Partial<Record<Kind, string | null>>;
      if (kinds.some((kind) => !mimeTypes[kind])) {
        setError("This browser cannot record video. Use a current Chrome or Edge on a computer.");
        setState("idle");
        return false;
      }
      void requestPersistence();

      const takeId = crypto.randomUUID();
      const recorders: Partial<Record<Kind, MediaRecorder>> = {};
      const started: Promise<[Kind, number]>[] = [];
      for (const kind of kinds) {
        const recorder = new MediaRecorder(streams[kind]!, {
          mimeType: mimeTypes[kind]!,
          videoBitsPerSecond: VIDEO_BITS_PER_SECOND[kind],
          audioBitsPerSecond: VIDEO_AUDIO_BITS_PER_SECOND,
          // A keyframe every chunk interval. Chrome's MP4 recorder hands data over only at a
          // keyframe, and its encoder makes few for a still screen: without this a screen
          // share can sit in memory for the whole take, and be lost with the tab.
          videoKeyFrameIntervalDuration: VIDEO_CHUNK_MS,
        } as MediaRecorderOptions);
        recorders[kind] = recorder;
        started.push(
          new Promise((resolve) => {
            recorder.onstart = () => resolve([kind, performance.now()]);
            setTimeout(() => resolve([kind, performance.now()]), START_TIMEOUT_MS);
          }),
        );
      }

      // Filed once every recorder has started, with when each did; chunks wait behind it.
      const filed = Promise.all(started).then(async (times) => {
        const first = Math.min(...times.map(([, at]) => at));
        const ids: Partial<Record<Kind, string>> = {};
        for (const [kind, at] of times) {
          const recording = await createRecording({
            ownerId,
            subject: RECORDING_SUBJECT,
            label: kind === "camera" ? "Camera" : "Screen",
            mimeType: recorders[kind]!.mimeType || mimeTypes[kind]!,
            upload: { takeId, kind, offsetMs: Math.round(at - first), contributor },
          });
          ids[kind] = recording.id;
        }
        return ids;
      });

      let writes: Promise<unknown> = filed.catch((e: unknown) => {
        setError(`This browser would not save the recording: ${(e as Error)?.message ?? "storage is unavailable"}.`);
      });
      const write = (job: (ids: Partial<Record<Kind, string>>) => Promise<void>) => {
        writes = writes
          .then(() => filed)
          .then(job)
          .then(() => onChunkRef.current())
          .catch((e: unknown) => {
            setError(`Part of the recording could not be saved: ${(e as Error)?.message ?? "the disk is full"}.`);
          });
      };

      let resolveStopped!: () => void;
      const current: Take = {
        recorders,
        startedAt: Date.now(),
        stopped: new Promise<void>((resolve) => (resolveStopped = resolve)),
      };
      let running = kinds.length;

      for (const kind of kinds) {
        const recorder = recorders[kind]!;
        let seq = 0;
        recorder.ondataavailable = (e) => {
          // Stored, and uploaded, in pieces small enough for any request to carry whole.
          for (const [start, end] of pieceRanges(e.data.size)) {
            const n = seq++;
            const piece = e.data.slice(start, end);
            write((ids) => appendChunk(ids[kind]!, n, piece));
          }
        };
        recorder.onstop = () => {
          write((ids) => markStopped(ids[kind]!));
          if (kind === "screen") setScreenRecording(false);
          // The camera is the take: when it stops, so does the screen.
          if (kind === "camera") void stop();
          if (--running > 0) return;
          void writes.then(() => {
            take.current = null;
            setStartedAt(null);
            setState("idle");
            onChunkRef.current();
            resolveStopped();
          });
        };
        recorder.onerror = () => {
          setError("The recorder failed. What was recorded up to now is saved.");
          void stop();
        };
      }

      for (const track of camera.getVideoTracks()) {
        track.onended = () => void stop("The camera was disconnected, so recording stopped. What was recorded is saved.");
      }
      for (const track of screen?.getVideoTracks() ?? []) {
        track.onended = () => {
          const recorder = recorders.screen;
          if (!recorder || recorder.state === "inactive") return;
          recorder.stop();
          setNotice("Screen sharing stopped. Your camera is still recording.");
        };
      }

      take.current = current;
      try {
        for (const kind of kinds) recorders[kind]!.start(VIDEO_CHUNK_MS);
      } catch (e) {
        setError(`Recording could not start: ${(e as Error)?.message ?? "the browser refused"}.`);
        for (const r of Object.values(recorders)) if (r.state !== "inactive") r.stop();
        take.current = null;
        setState("idle");
        return false;
      }
      setScreenRecording(Boolean(screen));
      setStartedAt(current.startedAt);
      setNow(current.startedAt);
      setState("recording");
      return true;
    },
    [ownerId, stop],
  );

  useEffect(() => {
    if (state !== "recording") return;
    const tick = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(tick);
  }, [state]);

  // Leaving the page stops the take; its chunks are already saved, and upload on the next visit.
  useEffect(
    () => () => {
      const current = take.current;
      if (!current) return;
      for (const r of Object.values(current.recorders)) if (r.state !== "inactive") r.stop();
    },
    [],
  );

  return {
    state,
    elapsedMs: startedAt === null ? 0 : now - startedAt,
    error,
    notice,
    /** The current take is recording the screen too. */
    screenRecording,
    start,
    stop,
    recording: state === "recording" || state === "stopping",
  };
}
