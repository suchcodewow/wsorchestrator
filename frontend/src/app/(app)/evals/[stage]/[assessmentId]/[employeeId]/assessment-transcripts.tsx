"use client";

/**
 * Transcripts on the scoring form. While the judge records, Deepgram's live
 * transcript runs underneath; when the recording stops, the whole saved file
 * is sent once to be transcribed and filed with the attendee's assessment,
 * whether or not the scores are ever submitted. Everyone who opens the form
 * sees every transcript filed for the attendee, whoever recorded it.
 *
 * The audio itself stays in this browser. A recording here that has no
 * transcript yet — the send failed, or the tab closed first — can be sent
 * again from the list.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, Loader2, RotateCw } from "lucide-react";
import { useRecordings } from "@/components/recording/recording-list";
import type { LiveTranscript } from "@/components/recording/use-live-transcript";
import { Button } from "@/components/ui/button";
import type { Transcript } from "@/lib/evals/transcripts";
import { formatDuration } from "@/lib/recording/format";
import { getRecording, readRecording } from "@/lib/recording/store";

/** A transcript as it reaches the browser. */
export type ClientTranscript = Omit<Transcript, "recordedAt"> & { recordedAt: string };

type Job = { status: "working"; live: boolean } | { status: "failed"; error: string };

const ERRORS: Record<string, string> = {
  empty: "Nothing was saved in this recording.",
  too_large: "This recording is too long to transcribe in one piece.",
  too_many: "This attendee already has as many transcripts as can be kept.",
  no_bootcamp: "No bootcamp is active, so nothing can be filed.",
  not_found: "This assessment or attendee can no longer be scored.",
  conflict: "This recording is already filed for someone else.",
  upstream: "Deepgram could not transcribe it.",
  forbidden: "You can no longer score — reload the page.",
};

const recordedLabel = (at: string | number) =>
  new Date(at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function useAssessmentTranscripts({
  assessmentId,
  employeeId,
  initial,
  enabled,
}: {
  assessmentId: string;
  employeeId: string;
  initial: ClientTranscript[];
  /** False without a bootcamp to file them under. */
  enabled: boolean;
}) {
  const [transcripts, setTranscripts] = useState(initial);
  const [jobs, setJobs] = useState<Record<string, Job>>({});
  const [unavailable, setUnavailable] = useState(false);
  // Each send in flight or failed, resolving to whether it was filed; set before the first await, so Submit sees it.
  const pending = useRef(new Map<string, Promise<boolean>>());

  const setJob = (id: string, job: Job | null) =>
    setJobs((all) => {
      const rest = { ...all };
      delete rest[id];
      return job ? { ...rest, [id]: job } : rest;
    });

  /** Sends one recording in this browser to be transcribed and filed. `live` marks the one just made. */
  const transcribe = useCallback(
    (recordingId: string, live = false): Promise<boolean> => {
      if (!enabled) return Promise.resolve(true);
      const sent = (async () => {
        setJob(recordingId, { status: "working", live });
        const fail = (error: string) => {
          setJob(recordingId, { status: "failed", error });
          return false;
        };
        try {
          const [recording, audio] = await Promise.all([getRecording(recordingId), readRecording(recordingId)]);
          if (!recording || !audio || audio.size === 0) return fail(ERRORS.empty!);
          const form = new FormData();
          form.append("audio", audio, recording.label);
          form.append("recordingId", recording.id);
          form.append("recordedAt", String(recording.startedAt));
          form.append("durationMs", String(recording.durationMs));
          const res = await fetch(
            `/api/evals/scoring/${assessmentId}/${encodeURIComponent(employeeId)}/transcripts`,
            { method: "POST", body: form },
          ).catch(() => null);
          if (!res) return fail("Could not reach the server.");
          const body = (await res.json().catch(() => null)) as (ClientTranscript & { error?: string }) | null;
          if (body?.error === "unconfigured") {
            setUnavailable(true);
            setJob(recordingId, null);
            return true;
          }
          if (!res.ok || !body?.id) return fail(ERRORS[body?.error ?? ""] ?? `Could not transcribe it (${res.status}).`);
          setTranscripts((all) =>
            [...all.filter((t) => t.recordingId !== body.recordingId), body].sort(
              (a, b) => a.recordedAt.localeCompare(b.recordedAt) || a.id.localeCompare(b.id),
            ),
          );
          setJob(recordingId, null);
          return true;
        } catch (e) {
          return fail(`This recording could not be read: ${(e as Error)?.message ?? "storage is unavailable"}.`);
        }
      })();
      pending.current.set(recordingId, sent);
      void sent.then((ok) => ok && pending.current.get(recordingId) === sent && pending.current.delete(recordingId));
      return sent;
    },
    [assessmentId, employeeId, enabled],
  );

  /** Waits for every send under way; false if any recording made here is still without its transcript. */
  const settle = useCallback(async () => (await Promise.all(pending.current.values())).every(Boolean), []);

  return { transcripts, jobs, unavailable, enabled, transcribe, settle };
}

export function AssessmentTranscripts({
  state,
  live,
  recording,
  ownerId,
  subject,
  version,
  since,
}: {
  state: ReturnType<typeof useAssessmentTranscripts>;
  live: LiveTranscript;
  recording: boolean;
  ownerId: string;
  subject: string;
  version: number;
  /** When the bootcamp began, in ms; recordings this browser made before it are not offered for filing here. */
  since: number | null;
}) {
  const { transcripts, jobs, unavailable, enabled, transcribe } = state;
  const { recordings } = useRecordings(ownerId, subject, version);
  const filed = new Set(transcripts.map((t) => t.recordingId));
  const unfiled = enabled
    ? (recordings ?? []).filter(
        (r) => r.status !== "recording" && !filed.has(r.id) && !jobs[r.id] && (since === null || r.startedAt >= since),
      )
    : [];
  const showLive = recording || live.status === "connecting" || live.status === "finishing";
  const jobRows = Object.entries(jobs);

  if (!showLive && transcripts.length === 0 && jobRows.length === 0 && unfiled.length === 0) {
    return unavailable || live.status === "unavailable" ? <NotSetUp /> : null;
  }

  return (
    <div className="space-y-3">
      {showLive && <LiveBox live={live} />}
      {(unavailable || live.status === "unavailable") && <NotSetUp />}

      {(transcripts.length > 0 || jobRows.length > 0 || unfiled.length > 0) && (
        <div className="space-y-1.5">
          <h4 className="flex items-center gap-1.5 text-sm font-medium">
            <FileText className="size-3.5 text-muted-foreground" />
            Transcripts
            {transcripts.length > 0 && <span className="font-normal text-muted-foreground">{transcripts.length}</span>}
          </h4>
          <ul className="divide-y rounded-lg border text-sm">
            {transcripts.map((t) => (
              <li key={t.id} className="space-y-1.5 px-3 py-2.5">
                <p className="flex flex-wrap gap-x-2 text-muted-foreground">
                  <span className="font-medium text-foreground">{recordedLabel(t.recordedAt)}</span>
                  <span className="tabular-nums">{formatDuration(t.durationMs)}</span>
                  {t.recordedByName && <span>· {t.recordedByName}</span>}
                </p>
                {t.text ? (
                  <p className="max-h-60 overflow-y-auto whitespace-pre-line leading-relaxed">{t.text}</p>
                ) : (
                  <p className="text-muted-foreground">Nothing heard.</p>
                )}
              </li>
            ))}
            {jobRows.map(([id, job]) => (
              <li key={id} className="space-y-1.5 px-3 py-2.5">
                {job.status === "working" ? (
                  <>
                    <p className="flex items-center gap-1.5 text-muted-foreground" role="status">
                      <Loader2 className="size-3.5 animate-spin" />
                      Transcribing the full recording…
                    </p>
                    {job.live && live.finals.length > 0 && (
                      <p className="max-h-60 overflow-y-auto leading-relaxed text-muted-foreground">{live.finals.join(" ")}</p>
                    )}
                  </>
                ) : (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span role="alert" className="text-destructive">
                      {job.error}
                    </span>
                    <Button variant="ghost" size="sm" className="ml-auto" onClick={() => void transcribe(id)}>
                      <RotateCw />
                      Retry
                    </Button>
                  </div>
                )}
              </li>
            ))}
            {unfiled.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5">
                <span className="font-medium">{recordedLabel(r.startedAt)}</span>
                <span className="tabular-nums text-muted-foreground">{formatDuration(r.durationMs)} · not transcribed</span>
                <Button variant="ghost" size="sm" className="ml-auto" onClick={() => void transcribe(r.id)}>
                  <FileText />
                  Transcribe
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function LiveBox({ live }: { live: LiveTranscript }) {
  const box = useRef<HTMLDivElement>(null);
  const text = live.finals.join(" ");
  // Follow the newest words, as captions do.
  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [text, live.interim]);
  if (live.status === "unavailable" || live.status === "idle") return null;

  return (
    <div className="space-y-1 rounded-lg border p-3 text-sm">
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        Live transcript
        {(live.status === "connecting" || live.status === "finishing") && <Loader2 className="size-3 animate-spin" />}
      </p>
      <div ref={box} aria-live="polite" className="max-h-40 min-h-10 overflow-y-auto leading-relaxed">
        {live.error ? (
          <span className="text-destructive">{live.error}</span>
        ) : text || live.interim ? (
          <>
            {text}
            {live.interim && <span className="text-muted-foreground"> {live.interim}</span>}
          </>
        ) : (
          <span className="text-muted-foreground">{live.status === "connecting" ? "Connecting…" : "Listening…"}</span>
        )}
      </div>
    </div>
  );
}

function NotSetUp() {
  return <p className="text-sm text-muted-foreground">Transcription is not set up on this deployment.</p>;
}
