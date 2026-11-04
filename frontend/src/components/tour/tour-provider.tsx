"use client";

/**
 * The page's tour: fetched whenever the path changes and played from the
 * header's question mark. The first time someone who does not administer the
 * page opens it at this version, the question mark glows to point the tour
 * out, once, and the version counts as seen whether or not they take it. Not
 * pointed out inside another site's frame, or while viewing as someone else,
 * where marking it seen would be recorded as them.
 *
 * A link carrying `?tour` (the editor's "Copy tour link") plays the tour for
 * whoever opens it, seen or not, a second after the page arrives: the page
 * is given a moment to be seen first, and the question mark is traced round
 * meanwhile, so the tour visibly comes from it. The parameter is then taken
 * off the address so a reload does not play it again.
 *
 * It also holds the editor, for whoever administers the page, and plays the
 * editor's unsaved steps as a preview, which marks nothing seen.
 */

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { TourEditor } from "@/components/tour/tour-editor";
import { TourPlayer } from "@/components/tour/tour-player";
import { isFramed } from "@/lib/framed";
import { TOUR_PARAM } from "@/lib/tours/link";
import type { Tour, TourStep } from "@/lib/tours/tours";

type TourContext = {
  tour: Tour | null;
  canEdit: boolean;
  playing: boolean;
  editing: boolean;
  /** How long the question mark's trace runs while it points the tour out, or null when it is not. */
  beckon: number | null;
  stopBeckoning: () => void;
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

/** How long a shared tour link waits, once the page is there, before playing. */
const LINK_DELAY_MS = 1000;
/** How long the question mark is traced round for someone new to the page. */
const FIRST_VISIT_MS = 2000;

/** Whether the address asks for the tour, taking the parameter off it if so. */
function takeTourParam(): boolean {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(TOUR_PARAM)) return false;
  url.searchParams.delete(TOUR_PARAM);
  window.history.replaceState(window.history.state, "", url);
  return true;
}

export function TourProvider({ autoPlay, children }: { autoPlay: boolean; children: React.ReactNode }) {
  const pathname = usePathname();
  const [match, setMatch] = useState<Match | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  // The path whose tour is open in the editor, so moving to another page closes it.
  const [editingAt, setEditingAt] = useState<string | null>(null);
  // The path whose question mark is traced round, and for how long.
  const [beckonAt, setBeckonAt] = useState<{ path: string; ms: number } | null>(null);

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

  useEffect(() => {
    const ask = new AbortController();
    let timer: number | undefined;
    fetch(`/api/tours/match?path=${encodeURIComponent(pathname)}`, { signal: ask.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: Omit<Match, "path"> | null) => {
        if (!body) return;
        setMatch({ path: pathname, ...body });
        const tour = body.tour && body.tour.steps.length > 0 ? body.tour : null;
        if (takeTourParam() && tour) {
          setBeckonAt({ path: pathname, ms: LINK_DELAY_MS });
          // Unless the question mark was clicked in the meantime and the tour is already going.
          timer = window.setTimeout(() => setRun((r) => r ?? { path: pathname, steps: tour.steps, start: 0, preview: false }), LINK_DELAY_MS);
        } else if (tour && tour.version > body.seenVersion && !body.canEdit && autoPlay && !isFramed()) {
          setBeckonAt({ path: pathname, ms: FIRST_VISIT_MS });
          markSeen(tour);
        }
      })
      .catch(() => {
        // Aborted by the next navigation, or offline: the page simply has no tour this time.
      });
    return () => {
      ask.abort();
      window.clearTimeout(timer);
    };
  }, [pathname, autoPlay, markSeen]);

  // A tour fetched for the page before this one is not this page's.
  const current = match?.path === pathname ? match : null;
  const tour = current?.tour ?? null;
  const playing = run?.path === pathname ? run : null;
  const editing = editingAt === pathname && !!current?.canEdit;
  const beckon = beckonAt?.path === pathname && tour ? beckonAt.ms : null;

  const stopBeckoning = useCallback(() => setBeckonAt(null), []);

  const finish = useCallback(() => {
    setRun(null);
    if (tour && playing && !playing.preview) markSeen(tour);
  }, [tour, playing, markSeen]);

  const play = useCallback(() => {
    setBeckonAt(null);
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
    <Context.Provider value={{ tour, canEdit: current?.canEdit ?? false, playing: !!playing, editing, beckon, stopBeckoning, play, edit }}>
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
