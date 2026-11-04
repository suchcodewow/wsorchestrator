"use client";

/**
 * The page's tour: fetched whenever the path changes, played by itself the
 * first time someone opens a page whose tour they have not seen at this
 * version, and again from the header's question mark. Not played by itself
 * inside another site's frame, or while viewing as someone else, where
 * marking it seen would be recorded as them.
 */

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { TourPlayer } from "@/components/tour/tour-player";
import { isFramed } from "@/lib/framed";
import type { Tour } from "@/lib/tours/tours";

type TourContext = {
  tour: Tour | null;
  canEdit: boolean;
  playing: boolean;
  play: () => void;
};

const Context = createContext<TourContext | null>(null);

/** The page's tour, for the header's controls; null outside a signed-in shell. */
export function usePageTour(): TourContext | null {
  return useContext(Context);
}

type Match = { path: string; tour: Tour | null; seenVersion: number; canEdit: boolean };

export function TourProvider({ autoPlay, children }: { autoPlay: boolean; children: React.ReactNode }) {
  const pathname = usePathname();
  const [match, setMatch] = useState<Match | null>(null);
  // The path whose tour is playing, so moving to another page stops it.
  const [playingAt, setPlayingAt] = useState<string | null>(null);

  useEffect(() => {
    const ask = new AbortController();
    fetch(`/api/tours/match?path=${encodeURIComponent(pathname)}`, { signal: ask.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: Omit<Match, "path"> | null) => {
        if (!body) return;
        setMatch({ path: pathname, ...body });
        const unseen = !!body.tour && body.tour.steps.length > 0 && body.tour.version > body.seenVersion;
        if (autoPlay && unseen && !isFramed()) setPlayingAt(pathname);
      })
      .catch(() => {
        // Aborted by the next navigation, or offline: the page simply has no tour this time.
      });
    return () => ask.abort();
  }, [pathname, autoPlay]);

  // A tour fetched for the page before this one is not this page's.
  const current = match?.path === pathname ? match : null;
  const tour = current?.tour ?? null;
  const playing = playingAt === pathname;

  const finish = useCallback(() => {
    setPlayingAt(null);
    if (!tour || !autoPlay) return;
    void fetch("/api/tours/seen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tourId: tour.id, version: tour.version }),
    }).catch(() => {});
    setMatch((m) => (m?.tour?.id === tour.id ? { ...m, seenVersion: tour.version } : m));
  }, [tour, autoPlay]);

  const play = useCallback(() => setPlayingAt(pathname), [pathname]);

  return (
    <Context.Provider value={{ tour, canEdit: current?.canEdit ?? false, playing, play }}>
      {children}
      {playing && tour && <TourPlayer key={`${tour.id}:${tour.version}`} steps={tour.steps} onFinish={finish} />}
    </Context.Provider>
  );
}
