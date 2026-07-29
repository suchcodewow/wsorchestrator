"use client";

import { MotionConfig } from "framer-motion";

/**
 * Wraps the app so every Framer Motion animation honours the OS "reduce
 * motion" setting without each component having to remember to.
 *
 * `reducedMotion="user"` keeps opacity transitions — which do not trigger
 * vestibular discomfort — and drops transform and layout animation, so the
 * interface stays legible and responsive rather than becoming inert.
 *
 * GSAP does not read this; those timelines guard themselves with
 * `gsap.matchMedia()` at their call sites.
 */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
