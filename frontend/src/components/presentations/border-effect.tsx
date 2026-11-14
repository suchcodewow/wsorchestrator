"use client";

/**
 * An animated edge round one element of a presentation page, drawn over it
 * and following its corners: an electric outline that crackles (an SVG
 * turbulence filter displacing a stroke, under a soft glow), a glow that
 * pulses, or a light that runs round the border. `scale` is the stage's drawn
 * width over its full 1920px, which the electric filter, measured in screen
 * pixels, needs to look the same on a thumbnail as on the projector.
 */

import type { CSSProperties } from "react";
import type { BorderEffect as Effect } from "@/lib/presentations/page";
import { cq } from "./page-view";

/** The electric filter for one stage, named `id`, defined once and used by each electric element on it. */
export function ElectricFilter({ id, scale }: { id: string; scale: number }) {
  const s = Math.max(scale, 0.05);
  return (
    <svg width="0" height="0" className="absolute" aria-hidden>
      <filter id={id} x="-25%" y="-25%" width="150%" height="150%" colorInterpolationFilters="sRGB">
        <feTurbulence type="turbulence" baseFrequency={0.02 / s} numOctaves={8} seed={1} result="n1" />
        <feOffset in="n1" dx="0" dy="0" result="o1">
          <animate attributeName="dy" values={`${700 * s}; 0`} dur="6s" repeatCount="indefinite" />
        </feOffset>
        <feTurbulence type="turbulence" baseFrequency={0.02 / s} numOctaves={8} seed={2} result="n2" />
        <feOffset in="n2" dx="0" dy="0" result="o2">
          <animate attributeName="dx" values={`${490 * s}; 0`} dur="6s" repeatCount="indefinite" />
        </feOffset>
        <feComposite in="o1" in2="o2" operator="arithmetic" k2="0.5" k3="0.5" result="noise" />
        <feDisplacementMap in="SourceGraphic" in2="noise" scale={30 * s} xChannelSelector="R" yChannelSelector="B" />
      </filter>
    </svg>
  );
}

export function BorderEffect({ effect, color, radius, filterId }: { effect: Effect; color: string; radius: string; filterId: string }) {
  const edge: CSSProperties = { position: "absolute", inset: 0, borderRadius: radius, pointerEvents: "none" };
  if (effect === "electric") {
    return (
      <>
        <span style={{ ...edge, border: `${cq(4)} solid ${color}`, filter: `blur(${cq(10)})`, opacity: 0.75 }} />
        <span style={{ ...edge, border: `${cq(4)} solid ${color}`, filter: `url(#${filterId})` }} />
      </>
    );
  }
  if (effect === "glow") {
    return <span style={{ ...edge, ["--effect-color" as string]: color, animation: "presentation-glow 2.4s ease-in-out infinite" }} />;
  }
  return (
    <span
      style={{
        ...edge,
        inset: `-${cq(3)}`,
        padding: cq(3),
        borderRadius: `calc(${radius} + ${cq(3)})`,
        background: `conic-gradient(from var(--presentation-angle), transparent 0 65%, ${color} 85%, transparent 100%)`,
        mask: "linear-gradient(#000 0 0) content-box exclude, linear-gradient(#000 0 0)",
        WebkitMask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
        WebkitMaskComposite: "xor",
        animation: "presentation-trace 3s linear infinite",
      }}
    />
  );
}
