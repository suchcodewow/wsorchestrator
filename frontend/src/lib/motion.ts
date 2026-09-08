/** The shared easings, springs and entrance variants. */

import type { Transition, Variants } from "framer-motion";

export const EASE = [0.22, 1, 0.36, 1] as const;

export const SPRING_SNAPPY: Transition = {
  type: "spring",
  stiffness: 420,
  damping: 30,
  mass: 0.6,
};

export const SPRING_SURFACE: Transition = {
  type: "spring",
  stiffness: 280,
  damping: 26,
  mass: 0.8,
};

export const FADE: Transition = { duration: 0.24, ease: EASE };

export const INTERACTIVE = {
  whileHover: { y: -1, scale: 1.015 },
  whileTap: { y: 0, scale: 0.985 },
  transition: SPRING_SNAPPY,
} as const;

export const LIFT = {
  whileHover: { y: -3 },
  transition: SPRING_SNAPPY,
} as const;

export const staggerParent = (stagger = 0.045, delay = 0): Variants => ({
  hidden: {},
  show: {
    transition: { staggerChildren: stagger, delayChildren: delay },
  },
});

export const riseChild: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.42, ease: EASE } },
};
