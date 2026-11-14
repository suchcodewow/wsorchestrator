"use client";

/**
 * Where a presentation is, for the full-screen player and the speaker-notes
 * tab alike: the slide or page shown, how far a page's reveals have gone,
 * whether the screen is blacked out, and moving on. Moving on uncovers a
 * page's next reveal before it leaves the page; moving back covers it again,
 * and arriving back on a page shows its reveals made. Every change is said on
 * the presentation's channel and every change heard there is followed, so the
 * two tabs show the same thing, the boxes clicked open included; a tab that
 * opens asks where the other one is.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { liveChannel, type LiveMessage, type ShowItem } from "@/lib/presentations/live";
import { revealSteps, START, toggleTrigger, type RevealState } from "@/lib/presentations/page";

export type LiveDeck = {
  items: ShowItem[];
  index: number;
  item: ShowItem | undefined;
  next: ShowItem | undefined;
  reveal: RevealState;
  black: boolean;
  /** To item `index`, its reveals from the start. */
  go: (index: number) => void;
  forward: () => void;
  back: () => void;
  /** A click on a page's element that reveals others. */
  trigger: (elementId: string) => void;
  toggleBlack: () => void;
};

type At = { index: number; reveal: RevealState; black: boolean };

const stepsOf = (item: ShowItem | undefined) => (item?.kind === "page" ? revealSteps(item.page.document).length : 0);

export function useLiveDeck(presentationId: string, items: ShowItem[], startItemId?: string): LiveDeck {
  const [at, setAt] = useState<At>(() => ({
    index: Math.max(
      0,
      items.findIndex((i) => i.id === startItemId),
    ),
    reveal: START,
    black: false,
  }));
  const channel = useRef<BroadcastChannel | null>(null);
  // What the handlers read, so the channel listener need not be made again on every move.
  const current = useRef({ at, items });
  useEffect(() => {
    current.current = { at, items };
  });

  const say = useCallback((next: At) => {
    const item = current.current.items[next.index];
    if (item) channel.current?.postMessage({ type: "at", itemId: item.id, black: next.black, ...next.reveal } satisfies LiveMessage);
  }, []);

  const move = useCallback(
    (next: At) => {
      current.current.at = next;
      setAt(next);
      say(next);
    },
    [say],
  );

  useEffect(() => {
    const ch = liveChannel(presentationId);
    channel.current = ch;
    if (!ch) return;
    ch.onmessage = (e: MessageEvent<LiveMessage>) => {
      const message = e.data;
      if (message.type === "hello") say(current.current.at);
      if (message.type === "at") {
        const index = current.current.items.findIndex((i) => i.id === message.itemId);
        if (index < 0) return;
        const next = { index, reveal: { step: message.step, clicked: message.clicked }, black: message.black };
        current.current.at = next;
        setAt(next);
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
      const count = current.current.items.length;
      if (count === 0) return;
      move({ index: Math.min(Math.max(to, 0), count - 1), reveal: START, black: false });
    },
    [move],
  );

  const forward = useCallback(() => {
    const { at: now, items: all } = current.current;
    if (now.reveal.step < stepsOf(all[now.index])) move({ ...now, reveal: { ...now.reveal, step: now.reveal.step + 1 }, black: false });
    else if (now.index < all.length - 1) go(now.index + 1);
  }, [go, move]);

  const back = useCallback(() => {
    const { at: now, items: all } = current.current;
    if (now.reveal.step > 0) move({ ...now, reveal: { ...now.reveal, step: now.reveal.step - 1 }, black: false });
    else if (now.index > 0) move({ index: now.index - 1, reveal: { step: stepsOf(all[now.index - 1]), clicked: [] }, black: false });
  }, [move]);

  const trigger = useCallback(
    (elementId: string) => {
      const now = current.current.at;
      move({ ...now, reveal: toggleTrigger(now.reveal, elementId), black: false });
    },
    [move],
  );

  const toggleBlack = useCallback(() => {
    const now = current.current.at;
    move({ ...now, black: !now.black });
  }, [move]);

  return {
    items,
    index: at.index,
    item: items[at.index],
    next: items[at.index + 1],
    reveal: at.reveal,
    black: at.black,
    go,
    forward,
    back,
    trigger,
    toggleBlack,
  };
}
