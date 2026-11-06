/**
 * The countdown, drawn as the round wall clock that hung in every 1950s
 * office: a red bezel, a cream face, and a sweep hand that goes once around
 * in the time a page is on screen. The wedge the hand has yet to cross is
 * tinted, so how much is left reads at a glance; the last few seconds shake.
 */

import { cn } from "@/lib/utils";

const FACE = 50;
/** A circle of this radius, stroked this thick, is a pie: the stroke fills it from the middle out to the rim. */
const PIE_R = FACE / 2;
const PIE_LENGTH = 2 * Math.PI * PIE_R;

export function WallClock({ secondsLeft, total }: { secondsLeft: number; total: number }) {
  const left = Math.max(0, Math.min(1, secondsLeft / total));
  const handAngle = (1 - left) * 360;
  const urgent = secondsLeft <= 5;

  return (
    <div className="flex items-center gap-3">
      <svg
        viewBox="-60 -60 120 120"
        role="img"
        aria-label={`${Math.ceil(secondsLeft)} seconds left`}
        className={cn("size-24 shrink-0 drop-shadow-md", urgent && "animate-[wall-clock-shake_0.4s_linear_infinite]")}
      >
        {/* Bezel and chrome ring */}
        <circle r="58" fill="#8f2d22" />
        <circle r="54" fill="#d9d9d4" />
        <circle r="51" fill="#f6edd4" />
        {/* The time left, as a wedge from the hand clockwise to twelve */}
        <circle
          r={PIE_R}
          fill="none"
          stroke={urgent ? "#d9483b" : "#e9b872"}
          strokeOpacity={0.5}
          strokeWidth={FACE}
          strokeDasharray={`${PIE_LENGTH * left} ${PIE_LENGTH}`}
          transform={`rotate(${handAngle - 90})`}
        />
        {Array.from({ length: 60 }, (_, i) => {
          const major = i % 5 === 0;
          return (
            <line
              key={i}
              y1={-(major ? 40 : 45)}
              y2={-48}
              stroke="#2b2118"
              strokeWidth={major ? 2 : 0.8}
              transform={`rotate(${i * 6})`}
            />
          );
        })}
        {[12, 3, 6, 9].map((n) => {
          const a = ((n % 12) / 12) * 2 * Math.PI;
          return (
            <text
              key={n}
              x={Math.sin(a) * 31}
              y={-Math.cos(a) * 31 + 4}
              textAnchor="middle"
              fontSize="11"
              fontWeight="700"
              fontFamily="Georgia, serif"
              fill="#2b2118"
            >
              {n}
            </text>
          );
        })}
        {/* Hour and minute hands stay at ten past ten, as they do in every clock advertisement */}
        <line y2="-22" stroke="#2b2118" strokeWidth="3.5" strokeLinecap="round" transform="rotate(-60)" />
        <line y2="-33" stroke="#2b2118" strokeWidth="2.5" strokeLinecap="round" transform="rotate(60)" />
        {/* The sweep hand */}
        <g transform={`rotate(${handAngle})`}>
          <line y1="10" y2="-44" stroke="#b3261e" strokeWidth="1.6" strokeLinecap="round" />
          <circle cy="-30" r="3" fill="none" stroke="#b3261e" strokeWidth="1.4" />
        </g>
        <circle r="3.5" fill="#2b2118" />
      </svg>
      <span className={cn("w-9 font-mono text-2xl font-semibold tabular-nums", urgent && "text-destructive")}>
        {Math.ceil(secondsLeft)}
      </span>
    </div>
  );
}
