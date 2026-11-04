/** A circle that fills as a video is watched, with a check in it once it has been watched to the end. */

import { Check, Play } from "lucide-react";
import { cn } from "@/lib/utils";

export function ProgressRing({
  fraction,
  completed,
  size = 30,
  className,
}: {
  /** 0 to 1. */
  fraction: number;
  completed: boolean;
  size?: number;
  className?: string;
}) {
  const stroke = Math.max(3, Math.round(size / 10));
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const shown = completed ? 1 : Math.min(1, Math.max(0, fraction));
  return (
    <span className={cn("relative inline-flex shrink-0 items-center justify-center", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeOpacity={0.2} strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill={completed ? "currentColor" : "none"}
          fillOpacity={completed ? 0.16 : 0}
          stroke="currentColor"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - shown)}
        />
      </svg>
      {completed ? (
        <Check className="absolute" style={{ width: size * 0.5, height: size * 0.5 }} strokeWidth={3} aria-hidden />
      ) : (
        <Play className="absolute fill-current" style={{ width: size * 0.38, height: size * 0.38, marginLeft: size * 0.04 }} aria-hidden />
      )}
    </span>
  );
}
