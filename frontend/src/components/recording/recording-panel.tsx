"use client";

/**
 * Record and Stop for one subject, with what this browser already holds for
 * it underneath. The recorder is passed in rather than owned, so the page can
 * stop it too — the scoring form does, on Submit.
 */

import Link from "next/link";
import { Loader2, Mic, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDuration } from "@/lib/recording/format";
import { LevelMeter, useAudioLevel } from "./level-meter";
import { RecordingList, useRecordings } from "./recording-list";
import type { useRecorder } from "./use-recorder";

export function RecordingPanel({
  recorder,
  ownerId,
  subject,
  version,
  onChanged,
}: {
  recorder: ReturnType<typeof useRecorder>;
  ownerId: string;
  subject: string;
  /** Bumped by the page whenever a recording is saved, to list it. */
  version: number;
  onChanged: () => void;
}) {
  const level = useAudioLevel(recorder.stream);
  const { recordings, error: listError } = useRecordings(ownerId, subject, version);
  const saved = (recordings ?? []).filter((r) => r.status !== "recording");

  return (
    <div className="space-y-3 rounded-2xl border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-center gap-3">
        {recorder.recording ? (
          <>
            <span className="flex items-center gap-2 text-sm font-medium" role="status">
              <span className="relative flex size-2.5">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-red-500 opacity-75" />
                <span className="relative inline-flex size-2.5 rounded-full bg-red-500" />
              </span>
              Recording <span className="tabular-nums">{formatDuration(recorder.elapsedMs)}</span>
            </span>
            <LevelMeter level={level} className="w-32" />
            <Button variant="outline" size="sm" onClick={() => void recorder.stop()} disabled={recorder.state === "stopping"}>
              {recorder.state === "stopping" ? <Loader2 className="animate-spin" /> : <Square className="fill-current" />}
              Stop
            </Button>
          </>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={() => void recorder.start()}
            disabled={recorder.state === "starting"}
          >
            {recorder.state === "starting" ? <Loader2 className="animate-spin" /> : <Mic />}
            Record
          </Button>
        )}
        {saved.length > 0 && !recorder.recording && (
          <span className="text-sm text-muted-foreground">
            {saved.length} {saved.length === 1 ? "recording" : "recordings"} saved on this computer
          </span>
        )}
      </div>

      {recorder.error && (
        <p role="alert" className="text-sm text-destructive">
          {recorder.error}{" "}
          <Link href="/me/check-pc" className="text-brand hover:underline">
            Check PC
          </Link>
        </p>
      )}
      {listError && (
        <p role="alert" className="text-sm text-destructive">
          {listError}
        </p>
      )}

      <RecordingList recordings={saved} onDeleted={onChanged} />
    </div>
  );
}
