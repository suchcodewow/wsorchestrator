"use client";

/**
 * One take: who recorded it and when, and each of its files — the camera with
 * the voice, and the screen if they shared one — to watch here or download.
 * While anything is still uploading the page refreshes itself.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { AlertTriangle, ArrowLeft, Camera, Download, Loader2, Monitor, Play, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { riseChild, staggerParent } from "@/lib/motion";
import { formatBytes, formatDuration } from "@/lib/recording/format";
import { deletesOn } from "@/lib/recording/video";
import type { RecordingTake, RecordingTrackRow } from "@/lib/recording/recordings";
import { formatWhen } from "../format";
import { TakeStatus } from "../take-status";

const REFRESH_MS = 5_000;

export function RecordingDetailView({ take }: { take: RecordingTake }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = take.tracks.some((t) => t.status === "uploading" || t.status === "assembling");
  const stalled = take.tracks.some((t) => t.stalled);
  const durationMs = Math.max(0, ...take.tracks.map((t) => t.durationMs ?? 0));
  const bytes = take.tracks.reduce((n, t) => n + (t.fileBytes ?? 0), 0);

  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => router.refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [pending, router]);

  async function remove() {
    if (!window.confirm(`Delete this recording${take.contributor ? ` by ${take.contributor}` : ""}, and every file of it?`)) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/recordings/${take.takeId}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404) return setError(`Could not delete it (${res.status}).`);
      router.push("/recordings");
    } catch {
      setError("Could not reach the server.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <motion.div variants={staggerParent(0.05)} initial="hidden" animate="show" className="space-y-6">
      <motion.div variants={riseChild} className="space-y-3">
        <Link href="/recordings" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" />
          Async Recordings
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-3xl font-medium tracking-tight">{take.contributor || "No name given"}</h1>
            <p className="text-muted-foreground tabular-nums" suppressHydrationWarning>
              {[
                formatWhen(take.startedAt),
                durationMs > 0 ? formatDuration(durationMs) : null,
                bytes > 0 ? formatBytes(bytes) : null,
                `deleted ${deletesOn(take.startedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            disabled={deleting}
            className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            onClick={() => void remove()}
          >
            {deleting ? <Loader2 className="animate-spin" /> : <Trash2 />}
            Delete
          </Button>
        </div>
      </motion.div>

      {error && (
        <motion.p variants={riseChild} role="alert" className="text-sm text-destructive">
          {error}
        </motion.p>
      )}

      {stalled && <StalledNote take={take} />}

      <motion.div variants={riseChild} className="grid gap-4 md:grid-cols-2">
        {take.tracks.map((track) => (
          <TrackCard key={track.id} track={track} />
        ))}
      </motion.div>
    </motion.div>
  );
}

/**
 * A take that stopped arriving. The recording is still on the participant's
 * computer, so the fix is theirs to make, and whoever shared the link is the
 * one who can ask: this says what to ask.
 */
function StalledNote({ take }: { take: RecordingTake }) {
  const last = take.tracks.reduce<string | null>((latest, t) => {
    const at = t.lastChunkAt ?? t.startedAt;
    return latest === null || at > latest ? at : latest;
  }, null);
  return (
    <motion.div
      variants={riseChild}
      role="status"
      className="flex items-start gap-3 rounded-2xl border border-amber-600/30 bg-amber-500/5 px-5 py-4 text-sm"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-500" />
      <p suppressHydrationWarning>
        <span className="font-medium">Nothing received since {last ? formatWhen(last) : "the take started"}.</span>{" "}
        {take.contributor || "Whoever recorded it"} probably closed the page or lost their connection before the upload
        finished. The recording is saved on their computer: ask them to open the recording link again, on the same computer
        and browser, and keep the window open until it says the upload is complete.
      </p>
    </motion.div>
  );
}

function TrackCard({ track }: { track: RecordingTrackRow }) {
  const [playing, setPlaying] = useState(false);
  const file = `/api/recordings/${track.takeId}/${track.kind}/file`;
  const ready = track.status === "ready";

  return (
    <div className="space-y-3 rounded-2xl border bg-card p-4 text-sm shadow-sm">
      <div className="flex items-center gap-2">
        {track.kind === "camera" ? <Camera className="size-4" /> : <Monitor className="size-4" />}
        <span className="font-medium">{track.kind === "camera" ? "Camera" : "Screen"}</span>
        <TakeStatus status={track.status} stalled={track.stalled} />
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {[
            track.durationMs !== null ? formatDuration(track.durationMs) : null,
            track.fileBytes !== null ? formatBytes(track.fileBytes) : null,
            track.offsetMs > 0 ? `starts +${(track.offsetMs / 1000).toFixed(2)}s` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </div>

      {ready && playing ? (
        <video src={file} controls autoPlay className="aspect-video w-full rounded-md bg-black" />
      ) : ready ? (
        <button
          type="button"
          onClick={() => setPlaying(true)}
          className="group/play relative flex aspect-video w-full cursor-pointer items-center justify-center overflow-hidden rounded-md bg-black"
          aria-label={`Play the ${track.kind} recording`}
        >
          <Thumbnail src={file} durationMs={track.durationMs} />
          <span className="absolute flex size-14 items-center justify-center rounded-full bg-black/55 text-white transition-transform group-hover/play:scale-110">
            <Play className="ml-0.5 size-6 fill-current" />
          </span>
        </button>
      ) : (
        <div className="flex aspect-video w-full items-center justify-center rounded-md bg-muted text-muted-foreground">
          {track.status === "failed" ? (
            <span className="px-4 text-center text-xs text-destructive">{track.error ?? "The file could not be put together."}</span>
          ) : (
            <span className="text-xs" suppressHydrationWarning>
              {track.lastChunkAt ? `Last upload ${formatWhen(track.lastChunkAt)}` : "Waiting for the first upload"}
            </span>
          )}
        </div>
      )}

      <Button variant="outline" size="sm" disabled={!ready} asChild={ready}>
        {ready ? (
          <a href={`${file}?download=1`}>
            <Download />
            Download {track.mimeType.startsWith("video/mp4") ? "MP4" : "WebM"}
          </a>
        ) : (
          <span>
            <Download />
            Download
          </span>
        )}
      </Button>
    </div>
  );
}

/**
 * A still of the file, to see who is in it at a glance: the video itself,
 * paused 5 seconds in (or halfway through a shorter one) and never played.
 * Only enough of the file to reach that frame is fetched.
 */
function Thumbnail({ src, durationMs }: { src: string; durationMs: number | null }) {
  const at = Math.min(5, (durationMs ?? 10_000) / 2000);
  return (
    <video
      src={src}
      preload="metadata"
      muted
      playsInline
      tabIndex={-1}
      aria-hidden
      onLoadedMetadata={(e) => {
        e.currentTarget.currentTime = at;
      }}
      className="pointer-events-none size-full object-contain"
    />
  );
}

