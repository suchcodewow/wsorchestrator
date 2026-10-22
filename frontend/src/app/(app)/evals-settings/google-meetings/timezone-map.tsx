"use client";

/**
 * A small world map cut into time zone bands, one per whole-hour UTC offset.
 * A band is tinted when someone the meeting is for lives in it; the ones in
 * the chosen range are solid. Click a band to start a range and another to
 * end it; the From and To lists beside the map set the same range, and reach
 * the offsets east of UTC+12 that the map has no room to draw.
 */

import { useState } from "react";
import { TIMEZONE_HOURS, timezoneRangeLabel } from "@/lib/evals/meeting-plan";
import { cn } from "@/lib/utils";
import { WORLD_LAND_PATH, WORLD_VIEWBOX } from "./world-land";

export type TimezoneCoverage = { byHour: Record<string, number>; unknown: number; total: number };

const MAP_HOURS = Array.from({ length: 25 }, (_, i) => i - 12);
const HOURS = Array.from({ length: TIMEZONE_HOURS.max - TIMEZONE_HOURS.min + 1 }, (_, i) => TIMEZONE_HOURS.min + i);

const SELECT =
  "h-9 w-full rounded-md border border-input bg-field px-2 text-sm text-foreground shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

const hourLabel = (h: number) => `UTC${h < 0 ? "-" : "+"}${Math.abs(h)}`;

/** A band is 15° wide, centred on its offset's meridian; the ends are cut by the map's edge. */
function band(hour: number): { x: number; width: number } {
  const x = Math.max(0, 180 + hour * 15 - 7.5);
  const end = Math.min(WORLD_VIEWBOX.width, 180 + hour * 15 + 7.5);
  return { x, width: end - x };
}

export function TimezoneMap({
  coverage,
  from,
  to,
  disabled,
  onChange,
}: {
  /** Null while it loads. */
  coverage: TimezoneCoverage | null;
  from: number;
  to: number;
  disabled?: boolean;
  onChange: (from: number, to: number) => void;
}) {
  const [anchor, setAnchor] = useState<number | null>(null);
  const counts = coverage?.byHour ?? {};
  const inRange = (h: number) => h >= from && h <= to;
  const covered = HOURS.filter((h) => (counts[h] ?? 0) > 0);
  const reached = covered.filter(inRange).reduce((n, h) => n + (counts[h] ?? 0), 0);

  function pick(hour: number) {
    if (disabled) return;
    if (anchor === null) {
      setAnchor(hour);
      onChange(hour, hour);
    } else {
      onChange(Math.min(anchor, hour), Math.max(anchor, hour));
      setAnchor(null);
    }
  }

  return (
    <div className="grid gap-3">
      <svg
        viewBox={`0 0 ${WORLD_VIEWBOX.width} ${WORLD_VIEWBOX.height + 14}`}
        role="group"
        aria-label="Time zones the meeting covers"
        className="w-full rounded-md border bg-field"
      >
        <path d={WORLD_LAND_PATH} className="fill-muted-foreground/30" />
        {MAP_HOURS.map((h) => {
          const { x, width } = band(h);
          const n = counts[h] ?? 0;
          const selected = inRange(h);
          return (
            <g key={h}>
              <rect
                x={x}
                y={0}
                width={width}
                height={WORLD_VIEWBOX.height}
                role="button"
                tabIndex={disabled ? -1 : 0}
                aria-pressed={selected}
                aria-label={`${hourLabel(h)}, ${n.toLocaleString()} ${n === 1 ? "person" : "people"}`}
                onClick={() => pick(h)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    pick(h);
                  }
                }}
                className={cn(
                  "stroke-border/60 outline-none focus-visible:stroke-ring focus-visible:stroke-2",
                  disabled ? "cursor-default" : "cursor-pointer hover:fill-brand/40",
                  selected ? "fill-brand/55" : n > 0 ? "fill-brand/15" : "fill-transparent",
                )}
                strokeWidth={0.4}
              >
                <title>{`${hourLabel(h)}: ${n.toLocaleString()} ${n === 1 ? "person" : "people"}`}</title>
              </rect>
              {h % 3 === 0 && (
                <text
                  x={x + width / 2}
                  y={WORLD_VIEWBOX.height + 10}
                  textAnchor="middle"
                  className={cn("pointer-events-none text-[7px]", selected ? "fill-foreground font-medium" : "fill-muted-foreground")}
                >
                  {h === 0 ? "0" : h > 0 ? `+${h}` : h}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      <div className="grid grid-cols-2 gap-3">
        {([
          ["From", from, (h: number) => onChange(h, Math.max(h, to))],
          ["To", to, (h: number) => onChange(Math.min(h, from), h)],
        ] as const).map(([label, value, set]) => (
          <div key={label} className="grid gap-1.5">
            <label htmlFor={`gm-tz-${label}`} className="text-sm font-medium">
              {label}
            </label>
            <select
              id={`gm-tz-${label}`}
              value={value}
              disabled={disabled}
              onChange={(e) => {
                setAnchor(null);
                set(Number(e.target.value));
              }}
              className={SELECT}
            >
              {HOURS.map((h) => (
                <option key={h} value={h}>
                  {hourLabel(h)}
                  {(counts[h] ?? 0) > 0 ? ` — ${counts[h]!.toLocaleString()}` : ""}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>

      <p className="text-xs text-muted-foreground" aria-live="polite">
        {coverage === null
          ? "Counting who is in each time zone…"
          : `${timezoneRangeLabel(from, to)} reaches ${reached.toLocaleString()} of ${coverage.total.toLocaleString()} ${coverage.total === 1 ? "person" : "people"} it is for.`}
        {coverage !== null && coverage.unknown > 0 && ` ${coverage.unknown.toLocaleString()} with no time zone on record will not be invited.`}
        {anchor !== null && " Pick the other end of the range."}
      </p>
    </div>
  );
}
