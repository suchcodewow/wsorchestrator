"use client";

/**
 * The page's tour: fetched whenever the path changes, played by itself the
 * first time someone opens a page whose tour they have not seen at this
 * version, and again from the header's question mark. Not played by itself
 * inside another site's frame, or while viewing as someone else, where
 * marking it seen would be recorded as them.
 *
 * It also holds the editor, for whoever administers the page, and plays the
 * editor's unsaved steps as a preview, which marks nothing seen.
 */

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { TourEditor } from "@/components/tour/tour-editor";
import { TourPlayer } from "@/components/tour/tour-player";
import { isFramed } from "@/lib/framed";
import type { Tour, TourStep } from "@/lib/tours/tours";

type TourContext = {
  tour: Tour | null;
  canEdit: boolean;
  playing: boolean;
  editing: boolean;
  play: () => void;
  edit: () => void;
};

const Context = createContext<TourContext | null>(null);

/** The page's tour, for the header's controls; null outside a signed-in shell. */
export function usePageTour(): TourContext | null {
  return useContext(Context);
}

type Match = { path: string; tour: Tour | null; seenVersion: number; canEdit: boolean };

/** What is playing, on which page: the saved tour, or the editor's steps as they stand. */
type Run = { path: string; steps: TourStep[]; start: number; preview: boolean };

export function TourProvider({ autoPlay, children }: { autoPlay: boolean; children: React.ReactNode }) {
  const pathname = usePathname();
  const [match, setMatch] = useState<Match | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  // The path whose tour is open in the editor, so moving to another page closes it.
  const [editingAt, setEditingAt] = useState<string | null>(null);

  useEffect(() => {
    const ask = new AbortController();
    fetch(`/api/tours/match?path=${encodeURIComponent(pathname)}`, { signal: ask.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: Omit<Match, "path"> | null) => {
        if (!body) return;
        setMatch({ path: pathname, ...body });
        const unseen = !!body.tour && body.tour.steps.length > 0 && body.tour.version > body.seenVersion;
        if (autoPlay && unseen && !isFramed()) setRun({ path: pathname, steps: body.tour!.steps, start: 0, preview: false });
      })
      .catch(() => {
        // Aborted by the next navigation, or offline: the page simply has no tour this time.
      });
    return () => ask.abort();
  }, [pathname, autoPlay]);

  // A tour fetched for the page before this one is not this page's.
  const current = match?.path === pathname ? match : null;
  const tour = current?.tour ?? null;
  const playing = run?.path === pathname ? run : null;
  const editing = editingAt === pathname && !!current?.canEdit;

  const markSeen = useCallback(
    (seen: Tour) => {
      if (!autoPlay) return;
      void fetch("/api/tours/seen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tourId: seen.id, version: seen.version }),
      }).catch(() => {});
      setMatch((m) => (m?.tour?.id === seen.id ? { ...m, seenVersion: seen.version } : m));
    },
    [autoPlay],
  );

  const finish = useCallback(() => {
    setRun(null);
    if (tour && playing && !playing.preview) markSeen(tour);
  }, [tour, playing, markSeen]);

  const play = useCallback(() => {
    if (tour) setRun({ path: pathname, steps: tour.steps, start: 0, preview: false });
  }, [tour, pathname]);

  const edit = useCallback(() => setEditingAt(pathname), [pathname]);

  const preview = useCallback((steps: TourStep[], start: number) => setRun({ path: pathname, steps, start, preview: true }), [pathname]);

  // The editor saved or removed the tour: show the page as it now is, without playing what its author just wrote.
  const saved = useCallback(
    (next: Tour | null) => {
      setMatch((m) => (m && m.path === pathname ? { ...m, tour: next, seenVersion: next?.version ?? 0 } : m));
      if (next) markSeen(next);
    },
    [pathname, markSeen],
  );

  return (
    <Context.Provider value={{ tour, canEdit: current?.canEdit ?? false, playing: !!playing, editing, play, edit }}>
      {children}
      {editing && (
        <TourEditor
          key={`${pathname}:${tour?.id ?? "new"}:${tour?.version ?? 0}`}
          tour={tour}
          hidden={!!playing}
          onPreview={preview}
          onSaved={saved}
          onClose={() => setEditingAt(null)}
        />
      )}
      {playing && playing.steps.length > 0 && (
        <TourPlayer
          key={`${playing.preview ? "preview" : tour?.id}:${playing.start}:${tour?.version ?? 0}`}
          steps={playing.steps}
          start={playing.start}
          onFinish={finish}
        />
      )}
    </Context.Provider>
  );
}
