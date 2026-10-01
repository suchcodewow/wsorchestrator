"use client";

/** 404 as a toy box tipped out over a yellow page. The toys can be thrown. */

import { motion } from "framer-motion";
import { useRef } from "react";
import { anton } from "./fonts";
import { ReturnHome } from "./return-home";

type Toy = {
  emoji: string;
  label: string;
  /** Where it lands, as a share of the viewport. */
  top: string;
  left: string;
  size: string;
  tilt: number;
  duration: number;
  delay: number;
  spin?: boolean;
};

const TOYS: Toy[] = [
  { emoji: "🪩", label: "disco ball", top: "-4%", left: "20%", size: "clamp(5rem, 14vw, 11rem)", tilt: 0, duration: 9, delay: 0, spin: true },
  { emoji: "🦄", label: "unicorn", top: "2%", left: "78%", size: "clamp(5rem, 15vw, 12rem)", tilt: -12, duration: 7, delay: 0.6 },
  { emoji: "📣", label: "megaphone", top: "34%", left: "44%", size: "clamp(5rem, 13vw, 10rem)", tilt: -18, duration: 5.5, delay: 0.3 },
  { emoji: "🍩", label: "doughnut", top: "62%", left: "-3%", size: "clamp(6rem, 18vw, 14rem)", tilt: 10, duration: 8, delay: 1.1 },
  { emoji: "🦆", label: "rubber duck", top: "64%", left: "76%", size: "clamp(5rem, 15vw, 12rem)", tilt: -6, duration: 6, delay: 0.2 },
  { emoji: "🐥", label: "chick", top: "76%", left: "22%", size: "clamp(4rem, 11vw, 9rem)", tilt: 8, duration: 4.5, delay: 0.9 },
  { emoji: "🪀", label: "yo-yo", top: "28%", left: "4%", size: "clamp(3rem, 8vw, 6rem)", tilt: 0, duration: 5, delay: 1.6 },
  { emoji: "🍕", label: "pizza slice", top: "16%", left: "60%", size: "clamp(3rem, 7vw, 5.5rem)", tilt: 24, duration: 6.5, delay: 0.4 },
];

export function Toybox() {
  const bounds = useRef<HTMLElement>(null);

  return (
    <main
      ref={bounds}
      className={`${anton.variable} relative flex min-h-dvh items-center justify-center overflow-hidden bg-[#ffe600] px-4 text-black`}
    >
      {/* No z-index here: the toys sit over the headline, and only the button
          is lifted above them, so a stray duck can never cover the way out. */}
      <div className="relative flex flex-col items-center gap-10 text-center">
        <h1 className="font-(family-name:--font-anton) text-[clamp(4.5rem,19vw,17rem)] leading-[0.9] tracking-tight uppercase">
          Page not
          <br />
          found
        </h1>
        <ReturnHome className="relative z-30" />
        <p className="text-sm font-medium tracking-wide text-black/60">
          psst, the toys are throwable
        </p>
      </div>

      {TOYS.map((toy) => (
        <motion.div
          key={toy.label}
          drag
          dragConstraints={bounds}
          dragElastic={0.4}
          dragTransition={{ bounceStiffness: 300, bounceDamping: 12 }}
          whileDrag={{ scale: 1.15, zIndex: 40 }}
          whileHover={{ scale: 1.06 }}
          className="absolute z-20 cursor-grab touch-none select-none active:cursor-grabbing"
          style={{ top: toy.top, left: toy.left }}
          role="img"
          aria-label={toy.label}
        >
          <span
            className={`${toy.spin ? "nf-spin" : "nf-bob"} block leading-none drop-shadow-[0_18px_22px_rgba(0,0,0,0.28)]`}
            style={
              {
                fontSize: toy.size,
                "--nf-tilt": `${toy.tilt}deg`,
                "--nf-duration": `${toy.duration}s`,
                "--nf-delay": `-${toy.delay}s`,
                transform: `rotate(${toy.tilt}deg)`,
              } as React.CSSProperties
            }
          >
            {toy.emoji}
          </span>
        </motion.div>
      ))}
    </main>
  );
}
