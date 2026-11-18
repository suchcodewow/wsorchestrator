"use client";

/**
 * Keeps a screen on a shared Guess Who game: reads it back about once a
 * second, and sends this screen's moves. A move shows at once (`optimistic`)
 * and the server's answer replaces it. While a move is on its way a read is
 * skipped, and an answer older than what is shown is ignored, so a card
 * doesn't flicker back and forth.
 *
 * The facilitator's screen follows its own game by code, and stops when that
 * game is ended (`gone`). The reps' page follows `CURRENT`, whichever game is
 * being shared: it waits while there is none and moves on to the next.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { GuessWhoConfig } from "@/lib/games/guess-who";
import type { GameState } from "@/lib/games/guess-who-play";

export type SharedGame = { code: string; config: GuessWhoConfig; state: GameState; rev: number };

/** Follow whichever game is being shared, rather than one by its code. */
export const CURRENT = "current";

const POLL_MS = 1000;

export function sharedGamePath(code: string) {
  return `/api/games/guess-who/sessions/${encodeURIComponent(code)}`;
}

export function useSharedGame(target: string | null, initial: SharedGame | null = null) {
  const follow = target === CURRENT;
  const [held, setGame] = useState<SharedGame | null>(initial);
  /** The code that no longer names a game: it was ended. */
  const [goneCode, setGoneCode] = useState<string | null>(null);
  const inflight = useRef(0);
  const rev = useRef(initial?.rev ?? -1);
  /** The game `rev` is about. */
  const revOf = useRef(initial?.code ?? null);

  const accept = useCallback((next: SharedGame, sameRevToo: boolean) => {
    // Another game than the one shown: take it at whatever revision it is.
    if (next.code !== revOf.current) {
      revOf.current = next.code;
      rev.current = -1;
    }
    if (next.rev > rev.current || (sameRevToo && next.rev === rev.current)) {
      rev.current = next.rev;
      setGame(next);
    }
  }, []);

  useEffect(() => {
    if (!target) return;
    let stopped = false;
    async function read() {
      if (stopped || inflight.current > 0 || document.hidden) return;
      try {
        const res = await fetch(sharedGamePath(target!), { cache: "no-store" });
        if (stopped || inflight.current > 0) return;
        if (res.status === 404 && follow) {
          // Nothing shared just now: keep looking.
          revOf.current = null;
          setGame(null);
        } else if (res.status === 404) {
          stopped = true;
          setGoneCode(target);
        } else if (res.ok) accept((await res.json()) as SharedGame, false);
      } catch {
        // Offline for a moment: the next read catches up.
      }
    }
    void read();
    const id = window.setInterval(() => void read(), POLL_MS);
    const onVisible = () => void read();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [target, follow, accept]);

  /** Sends a move to `path` under the game (`/flips`, `/moves`), showing `optimistic` until the answer arrives. */
  const send = useCallback(
    (path: string, body: unknown, optimistic?: (g: SharedGame) => SharedGame) => {
      const code = follow ? revOf.current : target;
      if (!code) return;
      inflight.current++;
      if (optimistic) setGame((g) => (g ? optimistic(g) : g));
      void fetch(`${sharedGamePath(code)}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
        .then(async (res) => {
          // Ended under a rep's tap: the next read finds what is shared now.
          if (res.status === 404) {
            if (follow) rev.current = -1;
            else setGoneCode(code);
          }
          // With quick taps still on their way, an earlier answer would stand a card back up for a moment; the last one has them all.
          else if (res.ok) {
            const next = (await res.json()) as SharedGame;
            if (inflight.current === 1) accept(next, true);
          }
          // Turned down: let the next read put the board back as the server has it.
          else rev.current = -1;
        })
        .catch(() => {
          rev.current = -1;
        })
        .finally(() => {
          inflight.current--;
        });
    },
    [target, follow, accept],
  );

  const game = follow ? held : target && held?.code === target ? held : null;
  return { game, gone: !follow && !!target && goneCode === target, send };
}

/* ------------------------------------------------------------------ */
/* What this browser remembers                                         */
/* ------------------------------------------------------------------ */

const listeners = new Set<() => void>();
/** Where a value is kept when the browser refuses storage, so it holds until a reload. */
const memory = new Map<string, string | null>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return memory.get(key) ?? null;
  }
}

export function writeStored(key: string, value: string | null) {
  memory.set(key, value);
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Storage blocked: kept in memory until a reload.
  }
  listeners.forEach((l) => l());
}

/** A value kept in this browser, read after the first render so the server's HTML and the browser's agree. */
export function useStored(key: string): [string | null, (value: string | null) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => readStored(key),
    () => null,
  );
  const set = useCallback((next: string | null) => writeStored(key, next), [key]);
  return [value, set];
}
