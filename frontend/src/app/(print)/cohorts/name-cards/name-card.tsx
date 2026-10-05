"use client";

/**
 * One letter-size page, folded down the middle into a tent: the name on each
 * half, turned to read upright from that side. Sizes and places match the
 * cards Training printed before this page: Arial at 100pt, so a 1in cap
 * height, with baselines 2.2in from the left edge and 2.04in from the right,
 * centred 5.6in down. A name too long for the page is set smaller to fit.
 *
 * The drawing is in hundredths of an inch, and SVG places text by its
 * baseline, so where a name lands does not hang on the font's metrics.
 */

import { useLayoutEffect, useRef, useState } from "react";
import type { CandidateStage } from "@/lib/evals/current-cohort";

const FONT_SIZE = 138.9; // 100pt
const MAX_LENGTH = 1030; // 10.3in, which the longest names on the old cards came to
const CENTRE = 560;
const LEFT_BASELINE = 220;
const RIGHT_BASELINE = 646;

const STAGE_MARKS: Record<CandidateStage, string> = { bootcamp: "BTC", intermediate: "INT" };

export function NameCard({ name, stage }: { name: string; stage: CandidateStage }) {
  const measure = useRef<SVGTextElement>(null);
  const [size, setSize] = useState(FONT_SIZE);

  useLayoutEffect(() => {
    const fit = () => {
      const length = measure.current?.getComputedTextLength() ?? 0;
      setSize(length > MAX_LENGTH ? (FONT_SIZE * MAX_LENGTH) / length : FONT_SIZE);
    };
    fit();
    // Measure again once fonts settle, in case the font arrived after the first measure.
    void document.fonts?.ready.then(fit);
  }, [name]);

  const text = { fontFamily: "Arial, Helvetica, sans-serif", textAnchor: "middle" } as const;

  return (
    <section className="h-264 w-204 shrink-0 overflow-hidden bg-white shadow-md break-after-page last:break-after-auto print:shadow-none">
      <svg viewBox="0 0 850 1100" width="100%" height="100%" role="img" aria-label={`${name}, ${STAGE_MARKS[stage]}`}>
        {/* Measured at full size, out of sight, so a shrunk name is not measured shrunk. */}
        <text ref={measure} x={0} y={-1000} fontSize={FONT_SIZE} style={{ ...text, textAnchor: "start" }} aria-hidden>
          {name}
        </text>
        <text transform={`translate(${LEFT_BASELINE} ${CENTRE}) rotate(90)`} fontSize={size} style={text}>
          {name}
        </text>
        <text transform={`translate(${RIGHT_BASELINE} ${CENTRE}) rotate(-90)`} fontSize={size} style={text}>
          {name}
        </text>
        <text x={40} y={55} fontSize={14} fontWeight={700} style={{ ...text, textAnchor: "start" }}>
          {STAGE_MARKS[stage]}
        </text>
      </svg>
    </section>
  );
}
