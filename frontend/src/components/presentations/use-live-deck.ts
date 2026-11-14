"use client";

/**
 * Where a presentation is, for the full-screen player and the speaker-notes
 * tab alike: the slide shown, whether the screen is blacked out, and moving
 * between slides. Every move is said on the presentation's channel, and a move
 * heard there is followed, so the two tabs stay on the same slide; a tab that
 * opens asks where the other one is.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { liveChannel, presentedSlides, type LiveMessage, type LiveSlide } from "@/lib/presentations/live";

export type LiveDeck<T extends LiveSlide> = {
  shown: T[];
  index: number;
  slide: T | undefined;
  next: T | undefined;
  black: boolean;
  go: (index: number) => void;
  step: (by: number) => void;
  toggleBlack: () => void;
};

export function useLiveDeck<T extends LiveSlide>(presentationId: string, slides: T[], startSlideId?: string): LiveDeck<T> {
  const shown = presentedSlides(slides);
  const startIndex = Math.max(
    0,
    shown.findIndex((s) => s.id === startSlideId),
  );
  const [index, setIndex] = useState(startIndex);
  const [black, setBlack] = useState(false);
  const channel = useRef<BroadcastChannel | null>(null);
  // What the handlers below read, so the channel listener need not be re-made on every move.
  const state = useRef({ index, black, shown });
  state.current = { index, black, shown };

  const say = useCallback((at: number, isBlack: boolean) => {
    const slide = state.current.shown[at];
    if (slide) channel.current?.postMessage({ type: "at", slideId: slide.id, black: isBlack } satisfies LiveMessage);
  }, []);

  useEffect(() => {
    const ch = liveChannel(presentationId);
    channel.current = ch;
    if (!ch) return;
    ch.onmessage = (e: MessageEvent<LiveMessage>) => {
      const message = e.data;
      if (message.type === "hello") say(state.current.index, state.current.black);
      if (message.type === "at") {
        const at = state.current.shown.findIndex((s) => s.id === message.slideId);
        if (at >= 0) setIndex(at);
        setBlack(message.black);
      }
    };
    ch.postMessage({ type: "hello" } satisfies LiveMessage);
    return () => {
      ch.close();
      channel.current = null;
    };
  }, [presentationId, say]);

  const go = useCallback(
    (to: number) => {
      const at = Math.min(Math.max(to, 0), state.current.shown.length - 1);
      if (at < 0) return;
      setIndex(at);
      setBlack(false);
      say(at, false);
    },
    [say],
  );

  const step = useCallback((by: number) => go(state.current.index + by), [go]);

  const toggleBlack = useCallback(() => {
    const now = !state.current.black;
    setBlack(now);
    say(state.current.index, now);
  }, [say]);

  return { shown, index, slide: shown[index], next: shown[index + 1], black, go, step, toggleBlack };
}
