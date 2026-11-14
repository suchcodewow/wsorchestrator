"use client";

/**
 * Presenting full screen: the deck's slides with the presentation's own pages
 * among them, one at a time on black. The arrow keys, a clicker or a click move
 * on, uncovering a page's reveals in turn first; on a page whose elements are
 * clicked to reveal others, only those clicks act, so a stray click never
 * leaves the page. B blacks the screen out; Escape leaves. `usePresenter`
 * opens it from a click, which the browser needs before it will go full
 * screen. The pointer hides while it is still.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { keyAction, showItems, slideImageUrl, type LivePage, type LiveSlide, type ShowItem } from "@/lib/presentations/live";
import { triggers } from "@/lib/presentations/page";
import { cn } from "@/lib/utils";
import { ItemView } from "./item-view";
import { useLiveDeck } from "./use-live-deck";

const IDLE_MS = 2_000;

export type Showable = { slides: LiveSlide[]; pages: LivePage[] };

type Opened = { show: Showable | null; startItemId?: string; error?: string };

/** `present()` from a click goes full screen and shows the presentation; `player` is what to render for it. */
export function usePresenter(presentationId: string, show?: Showable) {
  const [opened, setOpened] = useState<Opened | null>(null);

  const present = useCallback(
    (startItemId?: string) => {
      // Asked for first, inside the click: after an await the browser would refuse.
      void document.documentElement.requestFullscreen?.().catch(() => undefined);
      setOpened({ show: show ?? null, startItemId });
      if (show) return;
      fetch(`/api/presentations/${presentationId}`)
        .then(async (res) => {
          if (!res.ok) throw new Error(`The presentation could not be loaded (${res.status}).`);
          const body = (await res.json()) as Showable;
          setOpened((o) => o && { ...o, show: { slides: body.slides, pages: body.pages } });
        })
        .catch((err: Error) => setOpened((o) => o && { ...o, error: err.message }));
    },
    [presentationId, show],
  );

  const close = useCallback(() => {
    setOpened(null);
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
  }, []);

  const player = opened
    ? createPortal(
        opened.show ? (
          <Player presentationId={presentationId} show={opened.show} startItemId={opened.startItemId} onClose={close} />
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
  show,
  startItemId,
  onClose,
}: {
  presentationId: string;
  show: Showable;
  startItemId?: string;
  onClose: () => void;
}) {
  const items = useMemo(() => showItems(show.slides, show.pages), [show]);
  const { index, item, reveal, black, forward, back, go, trigger, toggleBlack } = useLiveDeck(presentationId, items, startItemId);
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
      if (action === "next") forward();
      if (action === "previous") back();
      if (action === "first") go(0);
      if (action === "last") go(items.length - 1);
      if (action === "black") toggleBlack();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [back, forward, go, items.length, onClose, toggleBlack]);

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

  // A page answered by clicks keeps its clicks for its own elements.
  const clicksAdvance = !(item?.kind === "page" && triggers(item.page.document).size > 0);
  // The slides either side are fetched ahead, so moving to one shows it at once.
  const ahead = [items[index + 1], items[index + 2], items[index - 1]].filter(
    (i): i is Extract<ShowItem, { kind: "slide" }> => i?.kind === "slide",
  );

  return (
    <div
      role="dialog"
      aria-label="Presentation"
      className={cn("fixed inset-0 z-200 grid place-items-center bg-black select-none", idle && "cursor-none")}
      onMouseMove={wake}
      onClick={() => clicksAdvance && forward()}
      onContextMenu={(e) => {
        e.preventDefault();
        back();
      }}
    >
      {item && !black && (
        <div className="w-[min(100vw,calc(100dvh*16/9))]" data-item={item.id}>
          <ItemView presentationId={presentationId} item={item} reveal={reveal} onTrigger={trigger} />
        </div>
      )}
      {items.length === 0 && <p className="text-sm text-white/70">There is nothing to present yet.</p>}
      <div className="hidden">
        {ahead.map((s) => (
          // eslint-disable-next-line @next/next/no-img-element -- fetched ahead, never shown
          <img key={s.id} src={slideImageUrl(presentationId, s.slide)} alt="" />
        ))}
      </div>
      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between p-4 text-sm text-white/80 transition-opacity",
          idle ? "opacity-0" : "opacity-100",
        )}
      >
        <span className="rounded-md bg-black/60 px-2.5 py-1 tabular-nums">{items.length ? `${index + 1} / ${items.length}` : ""}</span>
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
