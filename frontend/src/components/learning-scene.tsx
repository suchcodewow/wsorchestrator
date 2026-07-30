import { cn } from "@/lib/utils";

/**
 * The landing splash: a room part-way through a session — someone presenting a
 * schedule, everyone else watching from the near side of the table.
 *
 * Drawn rather than photographed, for the same reason the backdrop is a
 * gradient rather than an image: nothing to download, sharp at any width, and
 * it follows the theme instead of needing a second dark-mode asset.
 *
 * Depth is what makes this read as a room rather than as clip art. Camera
 * order is audience (large, cropped by the frame) -> table -> presenter ->
 * display, so the near figures crop the table and the far one is cropped by
 * it.
 *
 * Every solid is mixed toward `--background` rather than given an opacity:
 * these shapes overlap, and a translucent head with a table showing through it
 * stops reading as a person. Mixing keeps the depth cue — further away sits
 * closer to the background — while staying opaque.
 *
 * Figures are built from `--muted-foreground` because that token is a mid-tone
 * in *both* themes: dark silhouettes on white, light on near-black, with no
 * per-theme overrides. `--foreground` would swing to near-white and blow out
 * the dark view.
 */

const solid = (token: string, pct: number) =>
  `color-mix(in oklab, var(${token}) ${pct}%, var(--background))`;

/** Where each foreground silhouette sits, how big, and how it leans. */
const AUDIENCE = [
  { x: 305, scale: 0.97, tilt: 4, mix: 86 },
  { x: 640, scale: 1.05, tilt: -3, mix: 100 },
  { x: 975, scale: 0.93, tilt: 6, mix: 80 },
] as const;

/**
 * The schedule on the display — the same stacked bars as the brand mark.
 * Widths and gaps are irregular on purpose: an evenly-stepped chart reads as a
 * placeholder, an uneven one reads as data.
 */
const ROWS = [
  [{ x: 332, w: 200, o: 0.62 }, { x: 552, w: 108, o: 0.28 }],
  [{ x: 332, w: 124, o: 0.3 }, { x: 476, w: 192, o: 0.64 }],
  [{ x: 332, w: 272, o: 0.5 }],
  [{ x: 332, w: 100, o: 0.26 }, { x: 452, w: 152, o: 0.56 }],
  [{ x: 332, w: 214, o: 0.36 }],
] as const;

/**
 * Head and shoulders from behind, origin on the crop line at the frame foot.
 *
 * The slope from shoulder to neck is concave, not convex — that trapezius line
 * is the whole difference between a silhouette that reads as a person and one
 * that reads as a chess pawn.
 */
const SHOULDERS =
  "C -108 -108 -94 -134 -62 -146 C -46 -152 -32 -157 -20 -168 L 20 -168 C 32 -157 46 -152 62 -146 C 94 -134 108 -108 108 -70";
const BUST = `M -108 0 L -108 -70 ${SHOULDERS} L 108 0 Z`;
/** The lit edge only — closing the path would draw a line along the crop. */
const BUST_RIM = `M -108 -70 ${SHOULDERS}`;

function Bust({
  x,
  scale,
  tilt,
  mix,
}: {
  x: number;
  scale: number;
  tilt: number;
  mix: number;
}) {
  const fill = solid("--muted-foreground", mix);
  return (
    <g transform={`translate(${x} 620) scale(${scale})`}>
      <path d={BUST} fill={fill} />
      <g transform={`rotate(${tilt} 0 -168)`}>
        {/* Set low enough that the jaw meets the shoulders — a gap between the
            two is what turns a silhouette into a chess pawn. */}
        <circle cy="-196" r="34" fill={fill} />
        {/* Top arc only: a full circle would stroke a line across the chest. */}
        <path
          d="M -34 -196 A 34 34 0 0 1 34 -196"
          fill="none"
          stroke="var(--brand)"
          strokeOpacity="0.5"
          strokeWidth="2"
        />
      </g>
      <path
        d={BUST_RIM}
        fill="none"
        stroke="var(--brand)"
        strokeOpacity="0.4"
        strokeWidth="2"
      />
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
        {/* The moment the schedule is being read against. */}
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
        {/* Presenter: furthest back, so mixed closest to the background. */}
        <g transform="translate(158 424)" fill={far}>
          <path d="M -26 0 L -26 -58 C -26 -74 -20 -84 -10 -90 C -7 -93 -6 -98 -6 -103 L 6 -103 C 6 -98 7 -93 10 -90 C 20 -84 26 -74 26 -58 L 26 0 Z" />
          <path
            d="M 17 -78 L 66 -108"
            stroke={far}
            strokeWidth="11"
            strokeLinecap="round"
          />
          <circle cy="-122" r="17" />
        </g>

        {/* Full-bleed: a table with two visible ends reads as a prop, not a room. */}
        <rect
          x="-20"
          y="380"
          width="1240"
          height="44"
          fill={solid("--muted-foreground", 24)}
        />
        {/* Lit top edge — the table catches the display the same way faces do. */}
        <rect
          x="-20"
          y="380"
          width="1240"
          height="7"
          fill={solid("--muted-foreground", 40)}
        />

        {/* Laptops, screens turned back toward the people watching. */}
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
            {/* The deck, catching the light from its own screen. */}
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
