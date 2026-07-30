"use client";

import { useLayoutEffect, useRef } from "react";
import gsap from "gsap";

/**
 * The landing entrance: the copy settles in first, then the scene assembles
 * behind it — display, then desk, then the people.
 *
 * Same approach as the sign-in hero: GSAP because this is one authored
 * timeline spanning a server-rendered tree, and `data-` hooks rather than refs
 * so that tree stays plain markup with a single client wrapper around it.
 */
export function LandingHero({ children }: { children: React.ReactNode }) {
  const scope = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const ctx = gsap.context((self) => {
      const mm = gsap.matchMedia();

      mm.add(
        {
          full: "(prefers-reduced-motion: no-preference)",
          reduce: "(prefers-reduced-motion: reduce)",
        },
        (context) => {
          const { full } = context.conditions as { full: boolean };
          const q = self.selector!;

          // Reduced motion keeps the composition and drops the movement.
          if (!full) {
            gsap.set(q("[data-anim], [data-scene]"), {
              opacity: 1,
              clearProps: "transform",
            });
            return;
          }

          gsap
            .timeline({ defaults: { ease: "power3.out" } })
            .from(q("[data-anim]"), {
              opacity: 0,
              y: 14,
              duration: 0.6,
              stagger: 0.08,
            })
            .from(
              q('[data-scene="screen"]'),
              { opacity: 0, y: 16, scale: 0.97, duration: 0.8 },
              "-=0.35",
            )
            .from(
              q('[data-scene="room"]'),
              { opacity: 0, y: 12, duration: 0.6 },
              "-=0.55",
            )
            // The people arrive last, so the eye lands on them.
            .from(
              q('[data-scene="team"] > *'),
              { opacity: 0, y: 26, duration: 0.7, stagger: 0.09 },
              "-=0.45",
            );
        },
      );

      return () => mm.revert();
    }, scope);

    return () => ctx.revert();
  }, []);

  return <div ref={scope}>{children}</div>;
}
