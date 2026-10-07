"use client";

/** Runs the landing page's entrance animation. */

import { useLayoutEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

/** Seconds between one stage of a path and the next. */
const STEP = 0.42;

/**
 * Draws one path onto `tl` from its label `rail`: the heading, then each stage
 * in turn, with the rail (or, when wide, the segment after each dot) growing
 * along behind them. Returns how many stages it drew.
 */
function drawPath(tl: gsap.core.Timeline, path: HTMLElement, wide: boolean) {
  const pq = gsap.utils.selector(path);
  const stages: HTMLElement[] = pq('[data-timeline="stage"]');

  tl.from(pq('[data-timeline="heading"]'), { opacity: 0, y: 10, duration: 0.5 }, "rail-=0.3");

  if (!wide) {
    tl.from(
      pq('[data-timeline="rail"]'),
      { scaleY: 0, duration: STEP * stages.length, ease: "power1.inOut" },
      "rail",
    );
  }

  stages.forEach((stage, i) => {
    const at = `rail+=${i * STEP}`;
    const sq = gsap.utils.selector(stage);
    if (wide) {
      tl.from(sq('[data-timeline="segment"]'), { scaleX: 0, duration: STEP, ease: "none" }, `${at}+=0.15`);
    }
    tl.from(sq('[data-timeline="dot"]'), { scale: 0, duration: 0.35, ease: "back.out(2.5)" }, at).from(
      sq('[data-timeline="card"]'),
      { opacity: 0, y: 18, duration: 0.65 },
      at,
    );

    // Inside the card: a lab guide fills in its reader's project, rooms and
    // the room fill up, and a learner's checks land one by one before the cheer.
    const ticks = sq('[data-timeline="tick"]');
    tl.fromTo(
      sq('[data-timeline="var-from"]'),
      { opacity: 1 },
      { opacity: 0, duration: 0.25, ease: "none" },
      `${at}+=0.75`,
    )
      .from(sq('[data-timeline="var-to"]'), { opacity: 0, duration: 0.3, ease: "none" }, `${at}+=0.85`)
      .from(
        sq('[data-timeline="fill"]'),
        { scaleX: 0, duration: 1.1, ease: "power2.out", stagger: 0.12 },
        `${at}+=0.2`,
      )
      .from(ticks, { opacity: 0, x: -6, duration: 0.35, stagger: 0.18 }, `${at}+=0.45`)
      .from(
        sq('[data-timeline="cheer"]'),
        { opacity: 0, scale: 0.6, duration: 0.5, ease: "back.out(3)" },
        `${at}+=${0.45 + ticks.length * 0.18 + 0.1}`,
      );
  });

  return stages.length;
}

export function LandingHero({ children }: { children: React.ReactNode }) {
  const scope = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    gsap.registerPlugin(ScrollTrigger);

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
          const [first, ...rest]: HTMLElement[] = q('[data-timeline="path"]');

          const intro = gsap
            .timeline({ defaults: { ease: "power3.out" } })
            .from(q("[data-anim]"), {
              opacity: 0,
              y: 14,
              duration: 0.6,
              stagger: 0.08,
            })
            .addLabel("rail", "-=0.2");
          if (!first) return;
          const firstStages = drawPath(intro, first, wide);

          // A path further down waits to be scrolled to, and never starts
          // before the one above has reached its last stage.
          const ready = intro.labels.rail + (firstStages - 1) * STEP;
          for (const path of rest) {
            const tl = gsap.timeline({ paused: true, defaults: { ease: "power3.out" } }).addLabel("rail", 0.3);
            drawPath(tl, path, wide);

            let waiting = 2;
            const go = () => {
              if (--waiting === 0) tl.play();
            };
            intro.call(go, undefined, ready);
            ScrollTrigger.create({ trigger: path, start: "top 85%", once: true, onEnter: go });
          }
        },
      );

      return () => mm.revert();
    }, scope);

    return () => ctx.revert();
  }, []);

  return <div ref={scope}>{children}</div>;
}
