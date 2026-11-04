"use client";

/**
 * Two short rainbow dashes that race once around their parent's edge, fading
 * in as they set off and out as they finish, each with a blurred copy glowing
 * under it when `blur` is given. The rainbow is laid across the parent, so a
 * dash changes colour as it goes round. It follows the parent's rounded
 * corners and its size, and `onDone` fires once it has faded out. Nothing is
 * drawn for someone who asks for less motion.
 *
 * The parent must be positioned.
 */

import { useId, useLayoutEffect, useRef } from "react";

const RAINBOW = ["#ff3b6b", "#ff9f1c", "#ffe14d", "#3ddc84", "#3ab8ff", "#8a5cff", "#ff3b6b"];

export function GlowTrace({ duration, blur, onDone }: { duration: number; blur?: number; onDone?: () => void }) {
  const svg = useRef<SVGSVGElement>(null);
  // useId's characters are not all allowed in a url(#…) reference.
  const gradient = `glow-trace-${useId().replace(/[^\w-]/g, "")}`;

  // A rect's corner radius is an attribute, so it is copied from the parent's CSS.
  useLayoutEffect(() => {
    const el = svg.current;
    const parent = el?.parentElement;
    if (!el || !parent) return;
    const rx = String(parseFloat(getComputedStyle(parent).borderTopLeftRadius) || 0);
    el.querySelectorAll("rect").forEach((r) => r.setAttribute("rx", rx));
  }, []);

  const dash = { animation: `glow-trace-run ${duration}ms ease-in forwards` };
  return (
    <svg
      ref={svg}
      aria-hidden
      className="pointer-events-none absolute inset-0 size-full overflow-visible motion-reduce:hidden"
      style={{ animation: `glow-trace-fade ${duration}ms ease-in forwards` }}
      onAnimationEnd={(e) => {
        if (e.target === svg.current) onDone?.();
      }}
    >
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
          {RAINBOW.map((color, i) => (
            <stop key={i} offset={i / (RAINBOW.length - 1)} stopColor={color} />
          ))}
        </linearGradient>
      </defs>
      {!!blur && (
        <rect
          width="100%"
          height="100%"
          pathLength={100}
          fill="none"
          stroke={`url(#${gradient})`}
          strokeWidth={blur}
          strokeLinecap="round"
          strokeDasharray="20 30"
          style={{ ...dash, filter: `blur(${blur}px)` }}
        />
      )}
      <rect width="100%" height="100%" pathLength={100} fill="none" stroke={`url(#${gradient})`} strokeWidth={2} strokeLinecap="round" strokeDasharray="20 30" style={dash} />
    </svg>
  );
}
