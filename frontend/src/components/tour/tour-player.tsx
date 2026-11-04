"use client";

/**
 * Plays a tour: for each step, finds its element, scrolls it to the middle of
 * whichever box scrolls it, dims everything else, and puts the step's callout
 * beside it. A step whose element cannot be found within a few seconds, or is
 * not showing (a narrow window hides some), is passed over in the direction
 * the person was going; running off either end finishes the tour.
 *
 * The callout is a popover, not a modal: the page stays usable under it, so
 * someone can try the thing a step points at. Escape, Skip and Done finish it.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { autoUpdate, type Placement } from "@floating-ui/dom";
import { Button } from "@/components/ui/button";
import { anchorFloating } from "@/lib/floating";
import { resolveTarget } from "@/lib/tours/target";
import type { TourStep } from "@/lib/tours/tours";

/** How long a step waits for its element to appear: the page may still be loading it. */
const WAIT_MS = 3000;
/** How long a scroll is given to settle when the browser sends no `scrollend`. */
const SCROLL_MS = 700;
/** Room kept above the element when scrolling, for the sticky header. */
const SCROLL_MARGIN = 72;
/** How far the lit area reaches past the element. */
const HALO = 6;

const PLACEMENTS: Record<TourStep["placement"], Placement> = {
  auto: "bottom",
  top: "top",
  bottom: "bottom",
  left: "left",
  right: "right",
};

function showing(el: HTMLElement): boolean {
  return el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
}

/** The step's element once it is in the page and showing, or null after WAIT_MS. */
function waitForTarget(step: TourStep, signal: AbortSignal): Promise<HTMLElement | null> {
  const find = () => {
    const el = resolveTarget<HTMLElement>(step.target, document);
    return el && showing(el) ? el : null;
  };
  return new Promise((resolve) => {
    const now = find();
    if (now) return resolve(now);
    const observer = new MutationObserver(() => {
      const el = find();
      if (el) done(el);
    });
    const timer = window.setTimeout(() => done(null), WAIT_MS);
    function done(el: HTMLElement | null) {
      observer.disconnect();
      window.clearTimeout(timer);
      signal.removeEventListener("abort", aborted);
      resolve(el);
    }
    const aborted = () => done(null);
    signal.addEventListener("abort", aborted);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
  });
}

function inView(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  return r.top >= SCROLL_MARGIN && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth;
}

/** Scrolls `el` to the middle of every box that scrolls it, and resolves once the scrolling stops. */
function scrollToTarget(el: HTMLElement): Promise<void> {
  if (inView(el)) return Promise.resolve();
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const margin = el.style.scrollMarginTop;
  el.style.scrollMarginTop = `${SCROLL_MARGIN}px`;
  return new Promise((resolve) => {
    const done = () => {
      document.removeEventListener("scrollend", done, true);
      window.clearTimeout(timer);
      el.style.scrollMarginTop = margin;
      resolve();
    };
    // `scrollend` does not bubble; capturing on the document hears it from any scrolling box.
    document.addEventListener("scrollend", done, true);
    const timer = window.setTimeout(done, reduce ? 0 : SCROLL_MS);
    el.scrollIntoView({ block: "center", inline: "nearest", behavior: reduce ? "auto" : "smooth" });
  });
}

export function TourPlayer({ steps, start = 0, onFinish }: { steps: TourStep[]; start?: number; onFinish: () => void }) {
  const [index, setIndex] = useState(start);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [target, setTarget] = useState<{ index: number; el: HTMLElement } | null>(null);
  const spotlight = useRef<HTMLDivElement>(null);
  const callout = useRef<HTMLDivElement>(null);

  const finish = useCallback(() => onFinish(), [onFinish]);

  // Give focus back to whatever had it, usually the question mark, when the tour ends.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    return () => before?.focus?.({ preventScroll: true });
  }, []);

  // Find, then scroll to, this step's element; pass over a step that cannot be found.
  useEffect(() => {
    const step = steps[index];
    if (!step) {
      finish();
      return;
    }
    const ask = new AbortController();
    void (async () => {
      const el = await waitForTarget(step, ask.signal);
      if (ask.signal.aborted) return;
      if (!el) {
        const next = index + direction;
        if (next < 0 || next >= steps.length) finish();
        else setIndex(next);
        return;
      }
      await scrollToTarget(el);
      if (!ask.signal.aborted) setTarget({ index, el });
    })();
    return () => ask.abort();
  }, [index, direction, steps, finish]);

  const shown = target?.index === index ? target.el : null;

  // The lit area follows its element through scrolling and resizing; it is drawn over it, not beside it.
  useEffect(() => {
    const box = spotlight.current;
    if (!shown || !box) return;
    return autoUpdate(shown, box, () => {
      const r = shown.getBoundingClientRect();
      box.style.transform = `translate(${r.left - HALO}px, ${r.top - HALO}px)`;
      box.style.width = `${r.width + HALO * 2}px`;
      box.style.height = `${r.height + HALO * 2}px`;
      // Shown, and animated from step to step, only once it is somewhere: otherwise it would slide in from the corner.
      if (!("placed" in box.dataset)) requestAnimationFrame(() => (box.dataset.placed = ""));
    });
  }, [shown]);

  useEffect(() => {
    const box = callout.current;
    if (!shown || !box) return;
    const stop = anchorFloating(shown, box, { placement: PLACEMENTS[steps[index]!.placement], gap: HALO + 10 });
    box.focus({ preventScroll: true });
    return stop;
  }, [shown, index, steps]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [finish]);

  const go = (to: number) => {
    if (to >= steps.length) return finish();
    setDirection(to > index ? 1 : -1);
    setIndex(to);
  };

  const step = steps[index];
  if (!shown || !step) return null;
  const last = index === steps.length - 1;

  return createPortal(
    <>
      <div
        ref={spotlight}
        aria-hidden
        className="pointer-events-none invisible fixed top-0 left-0 z-50 rounded-lg shadow-[0_0_0_9999px_rgb(0_0_0/0.5)] ring-2 ring-primary duration-200 data-placed:visible data-placed:transition-[transform,width,height] motion-reduce:transition-none"
      />
      <div
        ref={callout}
        role="dialog"
        aria-label={step.title || `Step ${index + 1} of ${steps.length}`}
        tabIndex={-1}
        className="fixed top-0 left-0 z-50 flex w-80 max-w-[calc(100vw-24px)] flex-col gap-3 overflow-y-auto rounded-xl border bg-popover p-4 text-popover-foreground shadow-lg outline-none dark:border-foreground/20"
      >
        <div>
          <p className="text-xs text-muted-foreground">
            {index + 1} of {steps.length}
          </p>
          {step.title && <p className="font-medium">{step.title}</p>}
        </div>
        {step.body && <p className="text-sm whitespace-pre-line text-muted-foreground">{step.body}</p>}
        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={finish}>
            Skip tour
          </Button>
          <div className="flex gap-2">
            {index > 0 && (
              <Button variant="outline" size="sm" onClick={() => go(index - 1)}>
                Back
              </Button>
            )}
            <Button size="sm" onClick={() => go(index + 1)}>
              {last ? "Done" : "Next"}
            </Button>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}
