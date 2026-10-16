"use client";

/**
 * Plays a concept's video and keeps your place in it. The browser plays the
 * file straight from Cloud Storage on a signed link, so it seeks; this
 * reports where it is back to the app: every 30 seconds while playing, when
 * you pause or seek, when it ends and when you leave. Opening it again
 * carries on from where you stopped, or starts over if you had reached the
 * end.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, TriangleAlert } from "lucide-react";
import { VideoWithFeedback } from "@/components/video-feedback";
import { FILL_VIDEO, VideoPlayerDialog } from "@/components/video-player-dialog";
import type { ConceptState } from "@/lib/mimir/map/schema";

/** How often, while playing, the player says where it is. */
const REPORT_EVERY_MS = 30_000;

type Ready = { url: string; startAt: number };

const MESSAGES: Record<string, string> = {
  missing: "This video hasn't been uploaded to this environment yet.",
  not_configured: "Videos aren't set up on this server.",
  not_found: "That video isn't available.",
};

export function VideoDialog({
  conceptId,
  name,
  onClose,
  onState,
}: {
  conceptId: string;
  name: string;
  onClose: () => void;
  /** Called with your standing on the concept each time the app answers a report. */
  onState: (conceptId: string, state: ConceptState) => void;
}) {
  const [ready, setReady] = useState<Ready | null>(null);
  const [error, setError] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  /** Not before the player has moved to where it starts: an early report would overwrite your place with zero. */
  const started = useRef(false);
  const lastReport = useRef(0);
  /** The last position and length seen: the element is gone by the time closing it reports. */
  const seen = useRef({ position: 0, duration: 0 });
  const base = `/api/mimir/map/concepts/${encodeURIComponent(conceptId)}/video`;

  useEffect(() => {
    let cancelled = false;
    fetch(base)
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok) setError(MESSAGES[body?.error ?? ""] ?? `The video couldn't be loaded (${res.status}).`);
        else setReady({ url: body.url, startAt: body.startAt });
      })
      .catch(() => !cancelled && setError("Could not reach the server."));
    return () => {
      cancelled = true;
    };
  }, [base]);

  const report = useCallback(
    (ended = false, leaving = false) => {
      const el = video.current;
      if (el && el.duration > 0) seen.current = { position: el.currentTime, duration: el.duration };
      const { position, duration } = seen.current;
      if (!started.current || !(duration > 0)) return;
      const now = Date.now();
      if (!ended && !leaving && now - lastReport.current < 1000) return;
      lastReport.current = now;
      void fetch(base, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ position, duration, ended }),
        keepalive: leaving,
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((body: { state?: ConceptState } | null) => body?.state && onState(conceptId, body.state))
        .catch(() => undefined);
    },
    [base, conceptId, onState],
  );

  // Leaving the page or closing the player is a report too.
  const latest = useRef(report);
  useEffect(() => {
    latest.current = report;
  });
  useEffect(() => {
    const leave = () => latest.current(false, true);
    const hidden = () => document.visibilityState === "hidden" && leave();
    window.addEventListener("pagehide", leave);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("pagehide", leave);
      document.removeEventListener("visibilitychange", hidden);
      leave();
    };
  }, []);

  return (
    <VideoPlayerDialog title={name} description="Your place is kept: close it and carry on later." onClose={onClose}>
      {error ? (
        <p role="alert" className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-6 text-sm text-destructive">
          <TriangleAlert className="size-4 shrink-0" />
          {error}
        </p>
      ) : !ready ? (
        <div className="flex h-full items-center justify-center rounded-lg bg-muted/40 text-muted-foreground">
          <Loader2 className="size-6 animate-spin" aria-label="Loading the video" />
        </div>
      ) : (
        <VideoWithFeedback
          {...FILL_VIDEO}
          videoRef={video}
          feedback={{ kind: "mimir_concept", id: conceptId }}
          src={ready.url}
          controls
          playsInline
          preload="metadata"
          onLoadedMetadata={(e) => {
            const el = e.currentTarget;
            if (ready.startAt > 0 && ready.startAt < el.duration) el.currentTime = ready.startAt;
            started.current = true;
            void el.play().catch(() => undefined);
          }}
          onTimeUpdate={(e) => {
            const el = e.currentTarget;
            seen.current = { position: el.currentTime, duration: el.duration };
            if (!el.paused && Date.now() - lastReport.current >= REPORT_EVERY_MS) report();
          }}
          onPause={() => report()}
          onSeeked={() => report()}
          onEnded={() => report(true)}
          onError={() => setError("The video couldn't be played.")}
        />
      )}
    </VideoPlayerDialog>
  );
}
