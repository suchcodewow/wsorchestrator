import type { Transition, Variants } from "framer-motion";

/**
 * One motion vocabulary for the whole app. Interfaces feel designed rather
 * than assembled when everything accelerates the same way, so components pull
 * their timings from here instead of inventing their own.
 */

/**
 * The house curve: a gentle ease-out. Motion that starts fast and settles is
 * read as responsive; motion that eases in feels like lag.
 */
export const EASE = [0.22, 1, 0.36, 1] as const;

/** Pointer feedback. Fast enough to feel attached to the cursor. */
export const SPRING_SNAPPY: Transition = {
  type: "spring",
  stiffness: 420,
  damping: 30,
  mass: 0.6,
};

/** Surfaces arriving — a little overshoot gives them presence. */
export const SPRING_SURFACE: Transition = {
  type: "spring",
  stiffness: 280,
  damping: 26,
  mass: 0.8,
};

/** Anything that just needs to appear without drawing attention. */
export const FADE: Transition = { duration: 0.24, ease: EASE };

/**
 * Hover/press feedback shared by every clickable surface. The lift is a single
 * pixel and the scale barely over 1 — at this size it registers as the element
 * responding to the pointer rather than as an animation.
 */
export const INTERACTIVE = {
  whileHover: { y: -1, scale: 1.015 },
  whileTap: { y: 0, scale: 0.985 },
  transition: SPRING_SNAPPY,
} as const;

/** The same idea for larger surfaces, where a 1.015 scale would look wobbly. */
export const LIFT = {
  whileHover: { y: -3 },
  transition: SPRING_SNAPPY,
} as const;

/** Parent that walks its children in one after another. */
export const staggerParent = (stagger = 0.045, delay = 0): Variants => ({
  hidden: {},
  show: {
    transition: { staggerChildren: stagger, delayChildren: delay },
  },
});

/** Child of `staggerParent` — rises into place as it fades in. */
export const riseChild: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.42, ease: EASE } },
};
