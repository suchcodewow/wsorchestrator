"use client";

import { useLayoutEffect, useRef } from "react";
import gsap from "gsap";

/**
 * Runs the sign-in entrance: the panel and its contents settle into place in
 * sequence, and the glow behind the card breathes.
 *
 * GSAP rather than Framer here because this is one authored timeline across
 * several unrelated elements — expressing the same overlaps with per-component
 * variants would scatter the choreography across the tree.
 *
 * Children are marked with `data-anim` attributes instead of refs so the
 * markup stays a plain server-rendered tree with one client wrapper around it.
 */
export function SignInHero({ children }: { children: React.ReactNode }) {
  const scope = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const ctx = gsap.context((self) => {
      // `matchMedia` is how GSAP reads the reduced-motion preference; the
      // reduce branch simply reveals everything with no transforms.
      const mm = gsap.matchMedia();

      mm.add(
        {
          full: "(prefers-reduced-motion: no-preference)",
          reduce: "(prefers-reduced-motion: reduce)",
        },
        (context) => {
          const { full } = context.conditions as { full: boolean };
          const q = self.selector!;

          if (!full) {
            gsap.set(q("[data-anim]"), {
              opacity: 1,
              clearProps: "transform",
            });
            return;
          }

          gsap
            .timeline({ defaults: { ease: "power3.out" } })
            .from(q("[data-anim-card]"), {
              opacity: 0,
              y: 18,
              scale: 0.985,
              duration: 0.7,
            })
            .from(
              q("[data-anim]"),
              { opacity: 0, y: 10, duration: 0.55, stagger: 0.07 },
              "-=0.42",
            );
        },
      );

      return () => mm.revert();
    }, scope);

    return () => ctx.revert();
  }, []);

  return <div ref={scope}>{children}</div>;
}
