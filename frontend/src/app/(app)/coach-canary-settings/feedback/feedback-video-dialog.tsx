"use client";

/**
 * Plays a Mimir video from where a piece of feedback was left, in the version
 * it was left on, where that was recorded. It is for reading feedback, so it
 * has no rating buttons of its own and does not report the viewer's place:
 * watching here leaves their progress on the concept alone.
 */

import { useEffect, useState } from "react";
import { Loader2, TriangleAlert } from "lucide-react";
import { FILL_VIDEO, VideoPlayerDialog } from "@/components/video-player-dialog";
import type { VideoLanguage } from "@/lib/mimir/map/schema";

const MESSAGES: Record<string, string> = {
  missing: "This video hasn't been uploaded to this environment yet.",
  not_configured: "Videos aren't set up on this server.",
  not_found: "That video isn't available. It may have been removed from the map.",
};

export function FeedbackVideoDialog({
  conceptId,
  name,
  startAt,
  language,
  version,
  onClose,
}: {
  conceptId: string;
  name: string;
  /** Where to start, in seconds. */
  startAt: number;
  language: VideoLanguage;
  /** The file it was left on; null for feedback from before that was kept. */
  version: string | null;
  onClose: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ language, ...(version ? { version } : {}) });
    fetch(`/api/mimir/map/concepts/${encodeURIComponent(conceptId)}/video?${params}`)
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok) setError(MESSAGES[body?.error ?? ""] ?? `The video couldn't be loaded (${res.status}).`);
        else setUrl(body.url);
      })
      .catch(() => !cancelled && setError("Could not reach the server."));
    return () => {
      cancelled = true;
    };
  }, [conceptId, language, version]);

  return (
    <VideoPlayerDialog title={name} onClose={onClose}>
      {error ? (
        <p role="alert" className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-6 text-sm text-destructive">
          <TriangleAlert className="size-4 shrink-0" />
          {error}
        </p>
      ) : !url ? (
        <div className="flex h-full items-center justify-center rounded-lg bg-muted/40 text-muted-foreground">
          <Loader2 className="size-6 animate-spin" aria-label="Loading the video" />
        </div>
      ) : (
        <video
          className={FILL_VIDEO.className}
          src={url}
          controls
          playsInline
          preload="metadata"
          onLoadedMetadata={(e) => {
            const el = e.currentTarget;
            if (startAt > 0 && startAt < el.duration) el.currentTime = startAt;
            void el.play().catch(() => undefined);
          }}
          onError={() => setError("The video couldn't be played.")}
        />
      )}
    </VideoPlayerDialog>
  );
}
