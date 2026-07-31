import { cn } from "@/lib/utils";

/** Eight teeth, evenly spaced — enough to read as a gear at 18px, few enough
 *  that the gaps survive being drawn two pixels wide. */
const TEETH = [0, 45, 90, 135, 180, 225, 270, 315];

/**
 * The product mark: a gear in brand mint, turning slowly.
 *
 * Drawn rather than dropped in as a bitmap so it inherits the brand colour in
 * both themes and stays sharp at any density — and so the bore can be genuinely
 * transparent. That last part is why the body is a thick stroked circle rather
 * than a filled one with a hole punched in it: the tile behind it is a
 * translucent mint wash over whatever the page background happens to be, so a
 * hole filled with a solid colour would only match one of them.
 *
 * The spin is `motion-safe`, so it holds still for anyone who has asked the
 * system for reduced motion — the mark still has to be a logo first.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "relative inline-flex size-7 shrink-0 items-center justify-center rounded-[7px] bg-brand/10 text-brand ring-1 ring-brand/20",
        className,
      )}
      aria-hidden
    >
      <svg
        viewBox="0 0 24 24"
        className="size-4.5 motion-safe:animate-gear-turn"
        fill="none"
      >
        {TEETH.map((angle) => (
          <rect
            key={angle}
            x="10.78"
            y="1.1"
            width="2.44"
            height="5.6"
            rx="0.8"
            fill="currentColor"
            // Rotated about the viewBox centre rather than positioned by hand,
            // so the tooth geometry is written once.
            transform={`rotate(${angle} 12 12)`}
          />
        ))}
        {/*
         * A stroked ring, not a disc: the bore has to stay open or the whole
         * mark reads as a flower. The band is thin enough to leave a real hole
         * and wide enough that the teeth land inside it rather than beside it.
         */}
        <circle cx="12" cy="12" r="6.95" stroke="currentColor" strokeWidth="2.5" />
        <circle cx="12" cy="12" r="1.85" fill="currentColor" opacity="0.45" />
      </svg>
    </span>
  );
}
