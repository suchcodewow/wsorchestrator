/** The landing page's illustration of a session in progress. */

import { cn } from "@/lib/utils";

const solid = (token: string, pct: number) =>
  `color-mix(in oklab, var(${token}) ${pct}%, var(--background))`;

const AUDIENCE = [
  { x: 302, y: 626, scale: 0.96, tilt: 4, mix: 86 },
  { x: 640, y: 614, scale: 1.05, tilt: -3, mix: 100 },
  { x: 978, y: 630, scale: 0.92, tilt: 6, mix: 80 },
] as const;

const ROWS = [
  [{ x: 332, w: 200, o: 0.62 }, { x: 552, w: 108, o: 0.28 }],
  [{ x: 332, w: 124, o: 0.3 }, { x: 476, w: 192, o: 0.64 }],
  [{ x: 332, w: 272, o: 0.5 }],
  [{ x: 332, w: 100, o: 0.26 }, { x: 452, w: 152, o: 0.56 }],
  [{ x: 332, w: 214, o: 0.36 }],
] as const;

const SIDE_LEFT =
  "C -96 -92 -86 -112 -64 -124 C -46 -132 -30 -139 -21 -152 C -18 -160 -17 -167 -17 -176";
const SIDE_RIGHT =
  "C 17 -167 18 -160 21 -152 C 30 -139 46 -132 64 -124 C 86 -112 96 -92 96 -52";

const BUST = `M -98 0 L -96 -52 ${SIDE_LEFT} L 17 -176 ${SIDE_RIGHT} L 98 0 Z`;
const RIM_LEFT = `M -96 -52 ${SIDE_LEFT}`;
const RIM_RIGHT = `M 17 -176 ${SIDE_RIGHT}`;

function Bust({
  x,
  y,
  scale,
  tilt,
  mix,
}: {
  x: number;
  y: number;
  scale: number;
  tilt: number;
  mix: number;
}) {
  const fill = solid("--muted-foreground", mix);
  const rim = { stroke: "var(--brand)", strokeOpacity: 0.4, strokeWidth: 2 };
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <path d={BUST} fill={fill} />
      <path d={RIM_LEFT} fill="none" {...rim} />
      <path d={RIM_RIGHT} fill="none" {...rim} />
      <g transform={`rotate(${tilt} 0 -176)`}>
        <ellipse cy="-206" rx="33" ry="36" fill={fill} />
        <path
          d="M -33 -206 A 33 36 0 0 1 33 -206"
          fill="none"
          stroke="var(--brand)"
          strokeOpacity="0.5"
          strokeWidth="2"
        />
      </g>
    </g>
  );
}

export function LearningScene({ className }: { className?: string }) {
  const far = solid("--muted-foreground", 50);
  return (
    <svg
      viewBox="0 0 1200 620"
      role="img"
      aria-label="An IT team watching a colleague present a workshop schedule on a large display."
      className={cn("w-full", className)}
    >
      <defs>
        <radialGradient id="ls-glow">
          <stop offset="0%" stopColor="var(--brand)" stopOpacity="0.32" />
          <stop offset="100%" stopColor="var(--brand)" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="ls-screen" x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0%" stopColor="var(--brand)" stopOpacity="0.2" />
          <stop offset="100%" stopColor="var(--brand)" stopOpacity="0.06" />
        </linearGradient>
      </defs>

      <ellipse cx="580" cy="170" rx="450" ry="270" fill="url(#ls-glow)" />

      <g data-scene="screen">
        <rect
          x="300"
          y="30"
          width="560"
          height="270"
          rx="16"
          fill="url(#ls-screen)"
          stroke="var(--brand)"
          strokeOpacity="0.32"
          strokeWidth="2"
        />
        <rect
          x="332"
          y="62"
          width="136"
          height="12"
          rx="6"
          fill="var(--brand)"
          opacity="0.55"
        />
        {ROWS.map((row, i) =>
          row.map((bar) => (
            <rect
              key={`${i}-${bar.x}`}
              x={bar.x}
              y={104 + i * 32}
              width={bar.w}
              height="17"
              rx="8.5"
              fill="var(--brand)"
              opacity={bar.o}
            />
          )),
        )}
        <line
          x1="644"
          y1="90"
          x2="644"
          y2="262"
          stroke="var(--brand)"
          strokeOpacity="0.8"
          strokeWidth="2"
        />
        <circle cx="644" cy="90" r="4.5" fill="var(--brand)" />
      </g>

      <g data-scene="room">
        <g transform="translate(158 424)" fill={far}>
          <path d="M -25 0 L -26 -62 C -27 -84 -21 -95 -12 -100 C -8 -103 -7 -107 -7 -112 L 7 -112 C 7 -107 8 -103 12 -100 C 21 -95 27 -84 26 -62 L 25 0 Z" />
          <path
            d="M 14 -90 L 44 -97 L 62 -116"
            fill="none"
            stroke={far}
            strokeWidth="10"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <ellipse cx="2" cy="-126" rx="16" ry="17.5" />
        </g>

        <rect
          x="-20"
          y="380"
          width="1240"
          height="44"
          fill={solid("--muted-foreground", 24)}
        />
        <rect
          x="-20"
          y="380"
          width="1240"
          height="7"
          fill={solid("--muted-foreground", 40)}
        />

        {[470, 810].map((lx) => (
          <g key={lx} transform={`translate(${lx} 380)`}>
            <rect
              x="-38"
              y="-52"
              width="76"
              height="46"
              rx="4"
              fill={solid("--brand", 24)}
            />
            <rect
              x="-38"
              y="-52"
              width="76"
              height="46"
              rx="4"
              fill="none"
              stroke="var(--brand)"
              strokeOpacity="0.5"
              strokeWidth="2"
            />
            <rect x="-28" y="-42" width="40" height="5" rx="2.5" fill="var(--brand)" opacity="0.5" />
            <rect x="-28" y="-32" width="24" height="5" rx="2.5" fill="var(--brand)" opacity="0.32" />
            <rect
              x="-47"
              y="-7"
              width="94"
              height="7"
              rx="3.5"
              fill={solid("--muted-foreground", 46)}
            />
          </g>
        ))}
      </g>

      <g data-scene="team">
        {AUDIENCE.map((f) => (
          <Bust key={f.x} {...f} />
        ))}
      </g>
    </svg>
  );
}
