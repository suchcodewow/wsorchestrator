"use client";

import { useLayoutEffect, useRef } from "react";
import gsap from "gsap";
import { cn } from "@/lib/utils";

/**
 * Each bloom drifts on its own clock. The durations share no common factor
 * (11 / 15 / 19) and the delays are uneven, so the three never come back into
 * phase — if they did, the whole backdrop would read as one synchronised pulse
 * instead of as ambient movement.
 *
 * `hue` is a rotation in degrees, not a colour: rotating the hue of the
 * existing fill keeps every bloom derived from the theme tokens, so this still
 * follows a light/dark switch and any future change to `--brand`. The ranges
 * are small enough to stay inside the mint/teal family.
 */
const BLOOMS = [
  { key: "a", scale: 1.16, xPercent: 5, yPercent: 4, hue: 22, opacity: 0.9, duration: 11, delay: 0 },
  { key: "b", scale: 0.88, xPercent: -4, yPercent: 6, hue: -18, opacity: 0.75, duration: 15, delay: 1.5 },
  { key: "c", scale: 1.2, xPercent: -3, yPercent: -5, hue: 15, opacity: 0.95, duration: 19, delay: 3 },
] as const;

/**
 * The animated colour wash behind the app. Decorative only — hidden from
 * assistive tech and inert to the pointer.
 */
export function AmbientBackdrop({ className }: { className?: string }) {
  const scope = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const ctx = gsap.context(() => {
      const mm = gsap.matchMedia();

      // With reduced motion the blooms simply stay where they are: the colour
      // is part of the design, only the drift is the accessibility problem.
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        for (const b of BLOOMS) {
          gsap.to(`[data-bloom="${b.key}"]`, {
            scale: b.scale,
            xPercent: b.xPercent,
            yPercent: b.yPercent,
            opacity: b.opacity,
            filter: `hue-rotate(${b.hue}deg)`,
            duration: b.duration,
            delay: b.delay,
            ease: "sine.inOut",
            repeat: -1,
            yoyo: true,
          });
        }
      });

      return () => mm.revert();
    }, scope);

    return () => ctx.revert();
  }, []);

  return (
    <div
      ref={scope}
      aria-hidden
      // `overflow-hidden` matters: the blooms scale and translate past their
      // boxes, and without it they would extend the scrollable area.
      className={cn(
        "app-backdrop pointer-events-none overflow-hidden",
        className,
      )}
    >
      <div
        data-bloom="a"
        className="bloom bloom-a -left-[15%] -top-[25%] size-[70rem]"
      />
      <div
        data-bloom="b"
        className="bloom bloom-b -right-[20%] -top-[15%] size-[55rem]"
      />
      <div
        data-bloom="c"
        className="bloom bloom-c -bottom-[35%] left-1/4 size-[65rem]"
      />
    </div>
  );
}
