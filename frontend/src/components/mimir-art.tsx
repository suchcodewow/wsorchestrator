/**
 * Mimir, slightly abstract: the wise head in profile, eyes closed, its beard
 * running down into Mímisbrunnr, the well of wisdom, where Odin's eye glows
 * at the bottom; Yggdrasil's roots above, and his name in Elder Futhark
 * (ᛗᛁᛗᛁᚱ) arched over his brow. Drawn on its own night sky, so it reads the
 * same in light and dark.
 */

import { useId } from "react";
import { cn } from "@/lib/utils";

/** The five runes of MIMIR, as strokes in a 10 × 16 box: Mannaz, Isa, Mannaz, Isa, Raidho. */
const RUNES: Record<"M" | "I" | "R", string> = {
  M: "M1 16V0M9 16V0M1 0l8 7M9 0L1 7",
  I: "M5 16V0",
  R: "M2 16V0M2 0q8 2 6 5t-6 3M4 8l6 8",
};
const NAME = ["M", "I", "M", "I", "R"] as const;

export function MimirArt({ className, title = "Mimir" }: { className?: string; title?: string }) {
  const id = useId().replace(/:/g, "");
  const sky = `${id}-sky`;
  const glow = `${id}-glow`;
  const face = `${id}-face`;
  const line = `${id}-line`;
  const water = `${id}-water`;
  const blur = `${id}-blur`;

  // The runes sit on an arc over the head, centred on its brow.
  const runes = NAME.map((r, i) => {
    const angle = (-124 + i * 17) * (Math.PI / 180);
    const x = 164 + 96 * Math.cos(angle);
    const y = 124 + 96 * Math.sin(angle);
    return { r, x, y };
  });

  return (
    <svg viewBox="0 0 320 240" role="img" aria-label={title} className={cn("block", className)}>
      <title>{title}</title>
      <defs>
        <linearGradient id={sky} x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0" stopColor="#0b1026" />
          <stop offset="0.55" stopColor="#10213a" />
          <stop offset="1" stopColor="#06302e" />
        </linearGradient>
        <radialGradient id={glow} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#a7fff0" stopOpacity="1" />
          <stop offset="0.35" stopColor="#2ee6c5" stopOpacity="0.75" />
          <stop offset="1" stopColor="#2ee6c5" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={face} x1="0.2" y1="0" x2="0.9" y2="1">
          <stop offset="0" stopColor="#33479a" />
          <stop offset="0.55" stopColor="#1c4f6c" />
          <stop offset="1" stopColor="#0e5a52" />
        </linearGradient>
        <linearGradient id={line} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#c7d4ff" />
          <stop offset="1" stopColor="#2ee6c5" />
        </linearGradient>
        <linearGradient id={water} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#2ee6c5" stopOpacity="0" />
          <stop offset="0.5" stopColor="#5ff5da" stopOpacity="0.9" />
          <stop offset="1" stopColor="#2ee6c5" stopOpacity="0" />
        </linearGradient>
        <filter id={blur} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="6" />
        </filter>
      </defs>

      <rect width="320" height="240" fill={`url(#${sky})`} />

      {/* Stars */}
      <g fill="#dfe7ff">
        {[
          [28, 34, 1.1], [62, 18, 0.8], [96, 46, 0.7], [250, 22, 1], [286, 52, 0.8], [270, 96, 0.6],
          [40, 96, 0.6], [300, 140, 0.7], [18, 150, 0.8], [228, 60, 0.5], [130, 14, 0.6], [206, 12, 0.7],
        ].map(([x, y, r]) => (
          <circle key={`${x}-${y}`} cx={x} cy={y} r={r} opacity="0.7" />
        ))}
      </g>

      {/* Yggdrasil's roots, reaching down from above */}
      <g fill="none" stroke="#7c9cff" strokeLinecap="round" opacity="0.35">
        <path d="M-10 6C40 30 70 22 96 48S120 92 104 120" strokeWidth="2" />
        <path d="M60 -6C80 24 118 22 132 40" strokeWidth="1.4" />
        <path d="M330 4C282 30 250 18 232 46S214 92 238 118" strokeWidth="2" />
        <path d="M268 -6C250 22 224 20 206 34" strokeWidth="1.4" />
      </g>

      {/* The well, and Odin's eye at the bottom of it */}
      <ellipse cx="160" cy="206" rx="70" ry="22" fill={`url(#${glow})`} filter={`url(#${blur})`} opacity="0.55" />
      <g fill="none" stroke={`url(#${water})`} strokeLinecap="round">
        <ellipse cx="160" cy="206" rx="104" ry="22" strokeWidth="1" opacity="0.5" />
        <ellipse cx="160" cy="206" rx="78" ry="16" strokeWidth="1.3" opacity="0.7" />
        <ellipse cx="160" cy="206" rx="52" ry="11" strokeWidth="1.6" />
        <ellipse cx="160" cy="206" rx="28" ry="6" strokeWidth="1.8" />
      </g>
      <ellipse cx="160" cy="206" rx="11" ry="4.5" fill={`url(#${glow})`} />
      <circle cx="160" cy="206" r="2.2" fill="#ffffff" />

      {/* A halo of light behind the head */}
      <circle cx="164" cy="104" r="74" fill={`url(#${glow})`} opacity="0.22" filter={`url(#${blur})`} />

      {/* Long hair, swept back behind the head and into the roots */}
      <path
        d="M152 42C124 44 108 66 110 96C112 124 102 146 86 170C104 168 120 156 130 138C134 120 130 100 134 84Z"
        fill="#7c9cff"
        fillOpacity="0.16"
        stroke="#7c9cff"
        strokeOpacity="0.55"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <g fill="none" stroke="#7c9cff" strokeLinecap="round" opacity="0.55">
        <path d="M128 62C114 78 112 100 110 120S100 150 90 164" strokeWidth="1" />
        <path d="M138 52C122 62 118 84 120 106" strokeWidth="1" />
      </g>

      {/* Mimir, in profile, facing right: brow, nose, cheek and the back of the head */}
      <path
        d="M152 42C176 40 192 54 194 72C195 79 199 85 206 95C208 98 205 100 200 101L198 108C192 112 176 116 160 116C146 116 134 112 128 104C120 92 118 76 124 62C130 50 140 43 152 42Z"
        fill={`url(#${face})`}
        stroke={`url(#${line})`}
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      {/* The closed eye, the furrowed brow, and a band of knotwork across it */}
      <path d="M170 79q6 4 12 0" fill="none" stroke="#e8eeff" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M165 69q10-6 20 0" fill="none" stroke="#c7d4ff" strokeWidth="1.2" strokeLinecap="round" opacity="0.75" />
      <path
        d="M130 60q10-11 23-9t21 3"
        fill="none"
        stroke="#2ee6c5"
        strokeWidth="1.3"
        strokeDasharray="3 2.5"
        strokeLinecap="round"
        opacity="0.85"
      />

      {/* The beard: full from cheek to chin, braided, ending in four locks */}
      <path
        d="M199 104C204 118 201 134 195 148L190 166L184 156L178 174L171 160L164 178L158 161L150 170L146 152C138 138 133 122 134 104C146 112 166 116 182 113C190 111 196 108 199 104Z"
        fill={`url(#${face})`}
        stroke={`url(#${line})`}
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      {/* The moustache, curling down over it */}
      <path d="M203 102c-3 8-10 12-20 12" fill="none" stroke="#e8eeff" strokeWidth="1.7" strokeLinecap="round" />
      <g fill="none" stroke="#c7d4ff" strokeLinecap="round" opacity="0.75">
        {[0, 1, 2, 3].map((i) => (
          <path key={`a${i}`} d={`M${176 - i} ${122 + i * 10}l-3.5 4.5m3.5-4.5l3.5 4.5`} strokeWidth="1.1" />
        ))}
        {[0, 1, 2, 3].map((i) => (
          <path key={`b${i}`} d={`M${158 + i * 0.5} ${124 + i * 10}l-3 4.5m3-4.5l3 4.5`} strokeWidth="1" opacity="0.7" />
        ))}
      </g>
      {/* Each lock runs on down into the water */}
      <g fill="none" stroke={`url(#${line})`} strokeLinecap="round" opacity="0.75">
        <path d="M190 166C188 182 172 192 162 204" strokeWidth="1.2" />
        <path d="M178 174C176 188 166 196 161 204" strokeWidth="1.2" />
        <path d="M164 178C163 190 160 198 160 204" strokeWidth="1.4" />
        <path d="M150 170C148 184 154 196 158 204" strokeWidth="1.2" />
      </g>

      {/* MIMIR in runes, arched over the brow */}
      <g fill="none" stroke="#2ee6c5" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        {runes.map(({ r, x, y }, i) => (
          <path key={i} d={RUNES[r]} transform={`translate(${x - 4.25} ${y - 6.8}) scale(0.85)`} />
        ))}
      </g>
    </svg>
  );
}
