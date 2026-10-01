"use client";

/** 404 as an arcade cabinet counting down to the end of your last credit. */

import { useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";
import { pressStart } from "./fonts";
import { ReturnHome } from "./return-home";

export function GameOver() {
  const reduce = useReducedMotion();
  const [count, setCount] = useState(9);

  // 9 down to 0, a beat on "INSERT COIN", then round again. Nobody ever
  // actually continues.
  useEffect(() => {
    if (reduce) return;
    const id = setTimeout(() => setCount((n) => (n <= -2 ? 9 : n - 1)), 1000);
    return () => clearTimeout(id);
  }, [reduce, count]);

  return (
    <main
      className={`${pressStart.variable} relative flex min-h-dvh items-center justify-center overflow-hidden bg-black px-4 font-(family-name:--font-arcade) text-white`}
    >
      {/* CRT: scanlines over everything, and a vignette to curve the glass. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-20 bg-[repeating-linear-gradient(to_bottom,rgba(255,255,255,0.05)_0px,rgba(255,255,255,0.05)_1px,transparent_1px,transparent_3px)]"
      />
      <div aria-hidden className="pointer-events-none absolute inset-0 z-20 shadow-[inset_0_0_180px_60px_rgba(0,0,0,0.9)]" />

      <div className="nf-flicker relative z-10 flex w-full max-w-3xl flex-col items-center text-center">
        <div className="flex w-full justify-between text-[10px] leading-loose sm:text-sm">
          <p>
            <span className="text-red-500">1UP</span>
            <br />
            000404
          </p>
          <p>
            <span className="text-red-500">HIGH SCORE</span>
            <br />
            THE PAGE YOU WANTED
          </p>
        </div>

        <h1 className="mt-14 bg-gradient-to-b from-yellow-300 via-orange-400 to-fuchsia-600 bg-clip-text text-[clamp(2.4rem,10vw,6rem)] leading-tight text-transparent drop-shadow-[4px_4px_0_#3b0764]">
          GAME
          <br />
          OVER
        </h1>
        <p className="mt-6 text-[10px] leading-loose text-cyan-300 sm:text-xs">PAGE 404 COULD NOT BE FOUND</p>

        <div className="mt-10">
          <ReturnHome className="font-sans" />
        </div>

        <p className="mt-10 h-6 text-sm sm:text-lg" aria-live="off">
          {reduce || count < 0 ? (
            <span className="nf-blink text-yellow-300">INSERT COIN</span>
          ) : (
            <>
              CONTINUE? <span className="text-yellow-300">{count}</span>
            </>
          )}
        </p>

        <Chase />

        <p className="mt-8 text-[9px] text-white/40 sm:text-[10px]">© 2026 HARNESS EVENTS · CREDIT 0</p>
      </div>
    </main>
  );
}

/** A chomper eating a row of dots, chased by a ghost, forever. */
function Chase() {
  return (
    <div aria-hidden className="relative mt-10 h-10 w-full overflow-hidden">
      <div className="absolute inset-x-2 top-1/2 flex -translate-y-1/2 justify-between">
        {Array.from({ length: 24 }, (_, i) => (
          <span key={i} className={i % 6 === 5 ? "size-3 rounded-full bg-amber-200" : "size-1.5 bg-amber-200"} />
        ))}
      </div>
      {/* The eaten stretch: a black curtain whose leading edge is the mouth. */}
      <div className="nf-run absolute inset-y-0 -left-full w-full bg-black">
        <span className="nf-chomp absolute top-1/2 right-0 size-9 translate-x-1/2 -translate-y-1/2 rounded-full bg-yellow-300" />
        <span className="absolute top-1/2 right-16 -translate-y-1/2 text-3xl">👻</span>
      </div>
    </div>
  );
}
