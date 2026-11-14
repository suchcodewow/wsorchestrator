"use client";

/**
 * Presenting a deck full screen: one slide at a time on black, moved with the
 * arrow keys, a clicker, or a click; B blacks the screen out; Escape leaves.
 * `usePresenter` opens it from a click, which the browser needs before it will
 * go full screen. The pointer hides while it is still.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { keyAction, slideImageUrl, type LiveSlide } from "@/lib/presentations/live";
import { cn } from "@/lib/utils";
import { useLiveDeck } from "./use-live-deck";

const IDLE_MS = 2_000;

type Opened = { slides: LiveSlide[] | null; startSlideId?: string; error?: string };

/** `present()` from a click goes full screen and shows the deck; `player` is what to render for it. */
export function usePresenter(presentationId: string, slides?: LiveSlide[]) {
  const [opened, setOpened] = useState<Opened | null>(null);

  const present = useCallback(
    (startSlideId?: string) => {
      // Asked for first, inside the click: after an await the browser would refuse.
      void document.documentElement.requestFullscreen?.().catch(() => undefined);
      setOpened({ slides: slides ?? null, startSlideId });
      if (slides) return;
      fetch(`/api/presentations/${presentationId}`)
        .then(async (res) => {
          if (!res.ok) throw new Error(`The presentation could not be loaded (${res.status}).`);
          const body = (await res.json()) as { slides: LiveSlide[] };
          setOpened((o) => o && { ...o, slides: body.slides });
        })
        .catch((err: Error) => setOpened((o) => o && { ...o, error: err.message }));
    },
    [presentationId, slides],
  );

  const close = useCallback(() => {
    setOpened(null);
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
  }, []);

  const player = opened
    ? createPortal(
        opened.slides ? (
          <Player presentationId={presentationId} slides={opened.slides} startSlideId={opened.startSlideId} onClose={close} />
        ) : (
          <Backdrop onClose={close}>
            <p className="text-sm text-white/70">{opened.error ?? "Loading…"}</p>
          </Backdrop>
        ),
        document.body,
      )
    : null;

  return { present, player };
}

function Backdrop({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return <div className="fixed inset-0 z-200 grid place-items-center bg-black">{children}</div>;
}

function Player({
  presentationId,
  slides,
  startSlideId,
  onClose,
}: {
  presentationId: string;
  slides: LiveSlide[];
  startSlideId?: string;
  onClose: () => void;
}) {
  const deck = useLiveDeck(presentationId, slides, startSlideId);
  const { shown, index, slide, black, step, go, toggleBlack } = deck;
  const [idle, setIdle] = useState(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const wasFullscreen = useRef(false);

  // Leaving full screen (Escape, or the browser's own control) leaves the presentation.
  useEffect(() => {
    const onChange = () => {
      if (document.fullscreenElement) wasFullscreen.current = true;
      else if (wasFullscreen.current) onClose();
    };
    if (document.fullscreenElement) wasFullscreen.current = true;
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      const action = keyAction(e);
      if (!action) return;
      e.preventDefault();
      if (action === "next") step(1);
      if (action === "previous") step(-1);
      if (action === "first") go(0);
      if (action === "last") go(shown.length - 1);
      if (action === "black") toggleBlack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, onClose, shown.length, step, toggleBlack]);

  const wake = useCallback(() => {
    setIdle(false);
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setIdle(true), IDLE_MS);
  }, []);

  // The pointer starts shown and hides once still; only the timer needs starting.
  useEffect(() => {
    idleTimer.current = setTimeout(() => setIdle(true), IDLE_MS);
    return () => clearTimeout(idleTimer.current);
  }, []);

  // The slides either side are fetched ahead, so moving to one shows it at once.
  const ahead = [shown[index + 1], shown[index + 2], shown[index - 1]].filter((s): s is LiveSlide => Boolean(s));

  return (
    <div
      role="dialog"
      aria-label="Presentation"
      className={cn("fixed inset-0 z-200 select-none bg-black", idle && "cursor-none")}
      onMouseMove={wake}
      onClick={() => step(1)}
      onContextMenu={(e) => {
        e.preventDefault();
        step(-1);
      }}
    >
      {slide && !black && (
        // eslint-disable-next-line @next/next/no-img-element -- a full-screen slide, served by the app's own route
        <img key={slide.id} src={slideImageUrl(presentationId, slide)} alt={`Slide ${slide.number}`} className="size-full object-contain" />
      )}
      {shown.length === 0 && <p className="grid size-full place-items-center text-sm text-white/70">This deck has no slides to present.</p>}
      <div className="hidden">
        {ahead.map((s) => (
          // eslint-disable-next-line @next/next/no-img-element -- fetched ahead, never shown
          <img key={s.id} src={slideImageUrl(presentationId, s)} alt="" />
        ))}
      </div>
      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between p-4 text-sm text-white/80 transition-opacity",
          idle ? "opacity-0" : "opacity-100",
        )}
      >
        <span className="rounded-md bg-black/60 px-2.5 py-1 tabular-nums">{shown.length ? `${index + 1} / ${shown.length}` : ""}</span>
        <button
          type="button"
          aria-label="Stop presenting"
          className="pointer-events-auto rounded-md bg-black/60 p-1.5 hover:bg-black/80"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}
