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

/**
 * Where each foreground silhouette sits, how big, and how it leans.
 *
 * `y` varies as well as `scale`: three people cropped at exactly the same line
 * read as one figure stamped three times, and differing seat heights break that
 * faster than differing sizes do.
 */
const AUDIENCE = [
  { x: 302, y: 626, scale: 0.96, tilt: 4, mix: 86 },
  { x: 640, y: 614, scale: 1.05, tilt: -3, mix: 100 },
  { x: 978, y: 630, scale: 0.92, tilt: 6, mix: 80 },
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
 * Three things carry the read, and dropping any one of them lands back on a
 * chess pawn. The deltoid caps the shoulder in a curve instead of a corner. The
 * slope from there to the neck is concave — that trapezius line is what says
 * "person" more than the head does. And there is an actual neck: a head set
 * straight onto the shoulders is a bowling pin no matter how it is shaped.
 *
 * Shoulders are just under three head-widths across, which is roughly where a
 * real body sits; wider than that and the figure reads as a slab.
 */
/**
 * Left outline, shoulder upward: deltoid cap, then trapezius, then neck. The
 * neck is reached by a second curve rather than a straight line — a line leaves
 * a corner exactly where the eye looks for the trapezius, and a corner there
 * reads as armour.
 */
const SIDE_LEFT =
  "C -96 -92 -86 -112 -64 -124 C -46 -132 -30 -139 -21 -152 C -18 -160 -17 -167 -17 -176";
/** The same edge mirrored, read downward. */
const SIDE_RIGHT =
  "C 17 -167 18 -160 21 -152 C 30 -139 46 -132 64 -124 C 86 -112 96 -92 96 -52";

const BUST = `M -98 0 L -96 -52 ${SIDE_LEFT} L 17 -176 ${SIDE_RIGHT} L 98 0 Z`;
/** Lit edges only — closing either would draw a line along the crop. */
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
      {/*
       * Each shoulder is rimmed on its own, and both are drawn before the head.
       * A single stroke following the whole outline would run across the neck
       * opening and land a bright line over the back of the head.
       */}
      <path d={RIM_LEFT} fill="none" {...rim} />
      <path d={RIM_RIGHT} fill="none" {...rim} />
      <g transform={`rotate(${tilt} 0 -176)`}>
        {/* Slightly taller than wide, like a head. Set low enough to overlap
            the neck, so the two merge into one mass. */}
        <ellipse cy="-206" rx="33" ry="36" fill={fill} />
        {/* Top arc only: a full ellipse would stroke a line across the jaw. */}
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
        {/*
         * Presenter: furthest back, so mixed closest to the background. Turned
         * a little toward the display, which is why the head sits off centre
         * over the shoulders rather than squarely on them.
         *
         * The raised arm bends at an elbow instead of running straight from
         * shoulder to fingertip. One rigid diagonal is the difference between
         * someone gesturing at a screen and a signpost.
         */}
        <g transform="translate(158 424)" fill={far}>
          <path d="M -25 0 L -26 -62 C -27 -84 -21 -95 -12 -100 C -8 -103 -7 -107 -7 -112 L 7 -112 C 7 -107 8 -103 12 -100 C 21 -95 27 -84 26 -62 L 25 0 Z" />
          {/* Starts inside the torso so the shoulder joint has no seam. */}
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
