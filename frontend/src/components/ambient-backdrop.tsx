"use client";

/** The animated colour wash behind the app. */

import { useLayoutEffect, useRef } from "react";
import gsap from "gsap";
import { cn } from "@/lib/utils";

const BLOOMS = [
  { key: "a", scale: 1.16, xPercent: 5, yPercent: 4, hue: 22, opacity: 0.9, duration: 11, delay: 0 },
  { key: "b", scale: 0.88, xPercent: -4, yPercent: 6, hue: -18, opacity: 0.75, duration: 15, delay: 1.5 },
  { key: "c", scale: 1.2, xPercent: -3, yPercent: -5, hue: 15, opacity: 0.95, duration: 19, delay: 3 },
] as const;

export function AmbientBackdrop({ className }: { className?: string }) {
  const scope = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const ctx = gsap.context(() => {
      const mm = gsap.matchMedia();

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
