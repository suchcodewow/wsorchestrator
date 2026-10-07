/**
 * A radar of placements across the subjects, on Beginner, Intermediate and
 * Advanced rings. A subject not taken is left out of the shape rather than
 * drawn at zero, and its label greyed, so it never reads as a low score.
 */

import { LEVEL_LABELS } from "@/lib/iris/subjects";
import { cn } from "@/lib/utils";

export type RadarSeries = {
  /** One per axis: a level 1–3, or null for not taken. */
  values: readonly (number | null)[];
  /** person: the one this chart is about; median: the cohort's, dashed; faint: one of many, behind. */
  variant: "person" | "median" | "faint";
};

const SERIES_CLASS: Record<RadarSeries["variant"], string> = {
  person: "fill-brand/15 stroke-brand",
  median: "fill-muted-foreground/10 stroke-muted-foreground",
  faint: "fill-none stroke-brand/50",
};

export function Radar({
  axes,
  series,
  size = 360,
  showRingLabels = false,
  className,
  label,
}: {
  axes: readonly string[];
  series: readonly RadarSeries[];
  size?: number;
  showRingLabels?: boolean;
  className?: string;
  /** What the chart shows, for screen readers. */
  label: string;
}) {
  const n = axes.length;
  const pad = size * 0.24;
  const c = size / 2;
  const r = c - pad;
  const angle = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const at = (i: number, level: number) => {
    const d = (level / 3) * r;
    return [c + d * Math.cos(angle(i)), c + d * Math.sin(angle(i))] as const;
  };
  const ring = (level: number) =>
    axes.map((_, i) => at(i, level).join(",")).join(" ");
  const shape = (values: readonly (number | null)[]) =>
    values
      .map((v, i) => (v ? at(i, v).join(",") : null))
      .filter((p): p is string => p !== null)
      .join(" ");
  const person = series.find((s) => s.variant === "person");
  const fontSize = Math.max(11, size * 0.034);

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label}
      overflow="visible"
      className={cn("w-full overflow-visible", className)}
    >
      {[1, 2, 3].map((lv) => (
        <polygon key={lv} points={ring(lv)} className="fill-none stroke-border" strokeWidth={1} />
      ))}
      {axes.map((_, i) => {
        const [x, y] = at(i, 3);
        return <line key={i} x1={c} y1={c} x2={x} y2={y} className="stroke-border" strokeWidth={1} />;
      })}
      {showRingLabels &&
        [1, 2, 3].map((lv) => {
          const [, y] = at(0, lv);
          return (
            <text key={lv} x={c + 4} y={y + fontSize * 0.9} className="fill-muted-foreground" fontSize={fontSize * 0.8}>
              {LEVEL_LABELS[lv as 1 | 2 | 3]}
            </text>
          );
        })}
      {series.map((s, k) => {
        const points = shape(s.values);
        if (!points) return null;
        const single = points.split(" ").length < 3;
        return (
          <polygon
            key={k}
            points={points}
            className={cn(SERIES_CLASS[s.variant], single && "fill-none")}
            strokeWidth={s.variant === "faint" ? 1 : 2}
            strokeDasharray={s.variant === "median" ? "5 4" : undefined}
            strokeLinejoin="round"
          />
        );
      })}
      {person?.values.map((v, i) => {
        if (!v) return null;
        const [x, y] = at(i, v);
        return <circle key={i} cx={x} cy={y} r={size * 0.011} className="fill-brand stroke-card" strokeWidth={1.5} />;
      })}
      {axes.map((name, i) => {
        const [x, y] = at(i, 3.45);
        const cos = Math.cos(angle(i));
        const taken = !person || person.values[i];
        return (
          <text
            key={name}
            x={x}
            y={y}
            textAnchor={Math.abs(cos) < 0.2 ? "middle" : cos > 0 ? "start" : "end"}
            dominantBaseline="middle"
            fontSize={fontSize}
            className={taken ? "fill-foreground" : "fill-muted-foreground/60"}
          >
            {name}
            {!taken && " —"}
          </text>
        );
      })}
    </svg>
  );
}
