"use client";

/** Runs the landing page's entrance animation. */

import { useLayoutEffect, useRef } from "react";
import gsap from "gsap";

export function LandingHero({ children }: { children: React.ReactNode }) {
  const scope = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const ctx = gsap.context((self) => {
      const mm = gsap.matchMedia();

      mm.add(
        {
          full: "(prefers-reduced-motion: no-preference)",
          wide: "(min-width: 1024px)",
        },
        (context) => {
          const { full, wide } = context.conditions as {
            full: boolean;
            wide: boolean;
          };
          if (!full) return;

          const q = self.selector!;
          const stages: HTMLElement[] = q('[data-timeline="stage"]');
          const step = 0.42;

          const tl = gsap
            .timeline({ defaults: { ease: "power3.out" } })
            .from(q("[data-anim]"), {
              opacity: 0,
              y: 14,
              duration: 0.6,
              stagger: 0.08,
            })
            .addLabel("rail", "-=0.2");

          if (!wide) {
            tl.from(
              q('[data-timeline="rail"]'),
              {
                scaleY: 0,
                duration: step * stages.length,
                ease: "power1.inOut",
              },
              "rail",
            );
          }

          stages.forEach((stage, i) => {
            const at = `rail+=${i * step}`;
            const sq = gsap.utils.selector(stage);
            if (wide) {
              tl.from(
                sq('[data-timeline="segment"]'),
                { scaleX: 0, duration: step, ease: "none" },
                `${at}+=0.15`,
              );
            }
            tl.from(
              sq('[data-timeline="dot"]'),
              { scale: 0, duration: 0.35, ease: "back.out(2.5)" },
              at,
            ).from(
              sq('[data-timeline="card"]'),
              { opacity: 0, y: 18, duration: 0.65 },
              at,
            );
          });

          // The lab guide fills in its reader's project, and the room fills up.
          tl.fromTo(
            q('[data-timeline="var-from"]'),
            { opacity: 1 },
            { opacity: 0, duration: 0.25, ease: "none" },
            `rail+=${step + 0.75}`,
          )
            .from(
              q('[data-timeline="var-to"]'),
              { opacity: 0, duration: 0.3, ease: "none" },
              "<0.1",
            )
            .from(
              q('[data-timeline="claimed"]'),
              { scaleX: 0, duration: 1.1, ease: "power2.out" },
              `rail+=${2 * step + 0.2}`,
            );
        },
      );

      return () => mm.revert();
    }, scope);

    return () => ctx.revert();
  }, []);

  return <div ref={scope}>{children}</div>;
}
