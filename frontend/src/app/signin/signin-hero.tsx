"use client";

/** Runs the sign-in page's entrance animation. */

import { useLayoutEffect, useRef } from "react";
import gsap from "gsap";

export function SignInHero({ children }: { children: React.ReactNode }) {
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
