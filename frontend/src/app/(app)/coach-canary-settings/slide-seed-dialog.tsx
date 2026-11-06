"use client";

/**
 * A slide review slide rebuilt from its seed, in a window of its own, for the
 * Reporting and Coach Canary Feedback tabs: the slide as it was dealt, with
 * its mistakes marked. The seed is everything it needs, since the same seed
 * always makes the same slide.
 */

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { SlidePreview } from "../coach-canary/code-lab/slide-review-view";

export function SlideSeedDialog({ seed, onClose }: { seed: number | null; onClose: () => void }) {
  return (
    <Dialog open={seed !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-describedby={undefined} className="max-w-6xl">
        <DialogTitle>Slide {seed}</DialogTitle>
        {seed !== null && <SlidePreview seed={seed} />}
      </DialogContent>
    </Dialog>
  );
}

/** A seed that opens its slide, wherever a seed is listed. */
export function SeedButton({ seed, onOpen }: { seed: number; onOpen: (seed: number) => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onOpen(seed);
      }}
      className="cursor-pointer font-mono text-xs text-brand tabular-nums hover:underline"
    >
      {seed}
    </button>
  );
}
