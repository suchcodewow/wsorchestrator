"use client";

/**
 * The presenter's view: what the room sees, what comes next, and its speaker
 * notes, with a timer. It follows the full-screen player and moves it, with the
 * same keys; on one of the presentation's own pages, clicking an element here
 * reveals what it reveals on the screen too, so the presenter can answer from
 * the laptop.
 */

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Minus, Pause, Play, Plus, RotateCcw } from "lucide-react";
import { ItemView, itemLabel } from "@/components/presentations/item-view";
import { useLiveDeck } from "@/components/presentations/use-live-deck";
import { Button } from "@/components/ui/button";
import { keyAction, showItems, type LivePage, type LiveSlide, type ShowItem } from "@/lib/presentations/live";
import { START, type RevealState } from "@/lib/presentations/page";
import { cn } from "@/lib/utils";

const SIZES = [14, 16, 18, 21, 24, 28, 32, 38];
const SIZE_KEY = "presentations.notesSize";
const DEFAULT_SIZE = 3;

export function SpeakerNotes({ id, name, slides, pages }: { id: string; name: string; slides: LiveSlide[]; pages: LivePage[] }) {
  const items = useMemo(() => showItems(slides, pages), [slides, pages]);
  const { index, item, next, reveal, black, forward, back, go, trigger, toggleBlack } = useLiveDeck(id, items);
  const [size, setSize] = useState(DEFAULT_SIZE);
  const elapsed = useStopwatch();

  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(SIZE_KEY));
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the size this browser last chose is only known here
      if (saved >= 0 && saved < SIZES.length && localStorage.getItem(SIZE_KEY) !== null) setSize(saved);
    } catch {
      // Storage refused: the default size stands.
    }
  }, []);

  function resize(by: number) {
    const to = Math.min(Math.max(size + by, 0), SIZES.length - 1);
    setSize(to);
    try {
      localStorage.setItem(SIZE_KEY, String(to));
    } catch {
      // Storage refused: the size holds until the tab closes.
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
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
  }, [back, forward, go, items.length, toggleBlack]);

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground lg:h-dvh">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-5 py-2.5">
        <h1 className="min-w-0 flex-1 truncate font-medium">{name}</h1>
        <span className="text-sm tabular-nums text-muted-foreground">
          {item ? `${index + 1} of ${items.length} · ${itemLabel(item)}` : "Nothing to present"}
          {black && " · Screen blacked out"}
        </span>
        <div className="flex items-center gap-1">
          <span className="w-16 text-right font-mono text-sm tabular-nums">{elapsed.text}</span>
          <Button variant="ghost" size="icon" aria-label={elapsed.running ? "Pause timer" : "Start timer"} onClick={elapsed.toggle}>
            {elapsed.running ? <Pause /> : <Play />}
          </Button>
          <Button variant="ghost" size="icon" aria-label="Reset timer" onClick={elapsed.reset}>
            <RotateCcw />
          </Button>
        </div>
      </header>

      <main className="grid min-h-0 flex-1 gap-5 p-5 lg:grid-cols-[3fr_2fr]">
        <section className="flex min-h-0 flex-col gap-3">
          <Frame presentationId={id} item={item} reveal={reveal} dim={black} onTrigger={trigger} />
          <div className="flex items-center justify-center gap-2">
            <Button variant="outline" onClick={back} disabled={index === 0 && reveal.step === 0}>
              <ChevronLeft />
              Previous
            </Button>
            <Button variant="outline" onClick={forward}>
              Next
              <ChevronRight />
            </Button>
          </div>
        </section>

        <section className="flex min-h-0 flex-col gap-4">
          <div className="w-full max-w-sm">
            <p className="mb-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">Next</p>
            {next ? (
              <Frame presentationId={id} item={next} reveal={START} />
            ) : (
              <div className="grid aspect-video place-items-center rounded-lg border bg-muted text-sm text-muted-foreground">
                End of deck
              </div>
            )}
          </div>

          {/* Side by side on a laptop the notes fill the column; stacked on a narrow window they keep a readable height and the page scrolls. */}
          <div className="flex min-h-72 flex-1 flex-col rounded-lg border bg-card lg:min-h-0">
            <div className="flex items-center justify-between border-b px-4 py-1.5">
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Notes</p>
              <div className="flex items-center">
                <Button variant="ghost" size="icon" aria-label="Smaller text" onClick={() => resize(-1)} disabled={size === 0}>
                  <Minus />
                </Button>
                <Button variant="ghost" size="icon" aria-label="Larger text" onClick={() => resize(1)} disabled={size === SIZES.length - 1}>
                  <Plus />
                </Button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 leading-relaxed whitespace-pre-wrap" style={{ fontSize: SIZES[size] }}>
              {item?.notes || <span className="text-muted-foreground">No notes for this one.</span>}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

function Frame({
  presentationId,
  item,
  reveal,
  dim,
  onTrigger,
}: {
  presentationId: string;
  item?: ShowItem;
  reveal: RevealState;
  dim?: boolean;
  onTrigger?: (elementId: string) => void;
}) {
  return (
    <div className={cn("overflow-hidden rounded-lg border bg-black transition-opacity", dim && "opacity-25")}>
      {item ? (
        <ItemView key={item.id} presentationId={presentationId} item={item} reveal={reveal} onTrigger={onTrigger} />
      ) : (
        <div className="aspect-video" />
      )}
    </div>
  );
}

/** A timer for the talk: running from when the tab opens, paused and reset by hand. */
function useStopwatch() {
  const [running, setRunning] = useState(true);
  const [base, setBase] = useState(0);
  const [since, setSince] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [running]);

  const ms = base + (running ? now - since : 0);
  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const mm = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");

  return {
    running,
    text: hours ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`,
    toggle() {
      const t = Date.now();
      if (running) setBase(base + t - since);
      else setSince(t);
      setNow(t);
      setRunning(!running);
    },
    reset() {
      const t = Date.now();
      setBase(0);
      setSince(t);
      setNow(t);
    },
  };
}
