"use client";

/**
 * A small world map cut into time zone bands, one per whole-hour UTC offset.
 * Each person the meeting is for is an orange dot in their band, stacked
 * upward from the top with their name on hover; the bands in the chosen range
 * are tinted. A bar above the map is green where the meeting's start falls in
 * 9AM–5PM local time and red where it does not. Click a band to start a range and another to
 * end it; the From and To lists beside the map set the same range, and reach
 * the offsets east of UTC+12 that the map has no room to draw.
 */

import { useState } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  TIMEZONE_HOURS,
  offsetHour,
  offsetInRange,
  timezoneRangeLabel,
} from "@/lib/evals/meeting-plan";
import { cn } from "@/lib/utils";
import { WORLD_LAND_PATH, WORLD_VIEWBOX } from "./world-land";

export type TimezoneCoverage = {
  byHour: Record<string, number>;
  people: Record<string, string[]>;
  unknown: number;
  total: number;
};

const BAR_HEIGHT = 6;
const BAR_GAP = 2;
const WORK_START = 9;
const WORK_END = 17;

/** The local time, in hours, in a band `hour` offsets from UTC when it is `at`. */
function localHour(at: Date, hour: number): number {
  return (((at.getUTCHours() + at.getUTCMinutes() / 60 + hour) % 24) + 24) % 24;
}

/** Familiar zones whose name for the date shows what the UTC bands mean there: PDT sits on UTC-7 beside Arizona's MST. */
const NAMED_ZONES: [zone: string, locale: string][] = [
  ["America/Los_Angeles", "en-US"],
  ["America/Phoenix", "en-US"],
  ["America/Denver", "en-US"],
  ["America/Chicago", "en-US"],
  ["America/New_York", "en-US"],
  ["Europe/London", "en-GB"],
  ["Europe/Paris", "en-GB"],
];

/** Each UTC offset's zone names at `at`, such as -7: PDT and MST. */
function zoneNames(at: Date): Record<number, string[]> {
  const out: Record<number, string[]> = {};
  for (const [zone, locale] of NAMED_ZONES) {
    const name = new Intl.DateTimeFormat(locale, {
      timeZone: zone,
      timeZoneName: "short",
    })
      .formatToParts(at)
      .find((p) => p.type === "timeZoneName")?.value;
    if (!name) continue;
    const hour = offsetHour(zone, at);
    const list = (out[hour] ??= []);
    if (!list.includes(name)) list.push(name);
  }
  return out;
}

const clock = (t: number) => {
  const h = Math.floor(t);
  const m = Math.round((t - h) * 60);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};

const MAP_HOURS = Array.from({ length: 25 }, (_, i) => i - 12);
const HOURS = Array.from(
  { length: TIMEZONE_HOURS.max - TIMEZONE_HOURS.min + 1 },
  (_, i) => TIMEZONE_HOURS.min + i,
);

const SELECT =
  "h-9 w-full rounded-md border border-input bg-field px-2 text-sm text-foreground shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50";

const hourLabel = (h: number) => `UTC${h < 0 ? "-" : "+"}${Math.abs(h)}`;

/** Dot positions for `n` people in a band: columns filled top to bottom, each centred on the map's middle, packed tighter until they all fit. */
function dots(
  x: number,
  width: number,
  n: number,
): { cx: number; cy: number; r: number }[] {
  const middle = BAR_HEIGHT + BAR_GAP + WORLD_VIEWBOX.height / 2;
  const room = WORLD_VIEWBOX.height - 6;
  let step = 7;
  const rowsOf = (st: number) => Math.max(1, Math.floor(room / st));
  const colsOf = (st: number) => Math.max(1, Math.floor((width - 2) / st));
  while (step > 1.6 && rowsOf(step) * colsOf(step) < n) step -= 0.2;
  const rows = rowsOf(step);
  const used = Math.min(colsOf(step), Math.ceil(n / rows));
  const left = x + (width - (used - 1) * step) / 2;
  return Array.from({ length: n }, (_, i) => {
    const col = Math.floor(i / rows);
    const inColumn = Math.min(rows, n - col * rows);
    return {
      cx: left + col * step,
      cy: middle + ((i % rows) - (inColumn - 1) / 2) * step,
      r: Math.min(3.2, step * 0.45),
    };
  });
}

/** A band is 15° wide, centred on its offset's meridian; the ends are cut by the map's edge. */
function band(hour: number): { x: number; width: number } {
  const x = Math.max(0, 180 + hour * 15 - 7.5);
  const end = Math.min(WORLD_VIEWBOX.width, 180 + hour * 15 + 7.5);
  return { x, width: end - x };
}

export function TimezoneMap({
  coverage,
  meetingAt,
  from,
  to,
  disabled,
  onChange,
}: {
  /** Null while it loads. */
  coverage: TimezoneCoverage | null;
  /** When the meeting starts; null until one is picked, which leaves the bar grey. */
  meetingAt: Date | null;
  from: number;
  to: number;
  disabled?: boolean;
  onChange: (from: number, to: number) => void;
}) {
  const [anchor, setAnchor] = useState<number | null>(null);
  const names = zoneNames(meetingAt ?? new Date());
  const counts = coverage?.byHour ?? {};
  const people = coverage?.people ?? {};
  const inRange = (h: number) => offsetInRange(h, from, to);
  const covered = HOURS.filter((h) => (counts[h] ?? 0) > 0);
  const reached = covered
    .filter(inRange)
    .reduce((n, h) => n + (counts[h] ?? 0), 0);

  function pick(hour: number) {
    if (disabled) return;
    if (anchor === null) {
      setAnchor(hour);
      onChange(hour, hour);
    } else {
      onChange(anchor, hour);
      setAnchor(null);
    }
  }

  return (
    <TooltipProvider>
      <div className="grid gap-3">
        <svg
          viewBox={`0 0 ${WORLD_VIEWBOX.width} ${WORLD_VIEWBOX.height + 24 + BAR_HEIGHT + BAR_GAP}`}
          role="group"
          aria-label="Time zones the meeting covers"
          className="w-full rounded-md border bg-field"
        >
          {MAP_HOURS.map((h) => {
            const { x, width } = band(h);
            const t = meetingAt ? localHour(meetingAt, h) : null;
            const working = t !== null && t >= WORK_START && t < WORK_END;
            return (
              <rect
                key={h}
                x={x}
                y={0}
                width={width}
                height={BAR_HEIGHT}
                className={
                  t === null
                    ? "fill-muted-foreground/20"
                    : working
                      ? "fill-green-500"
                      : "fill-red-500"
                }
              >
                <title>
                  {t === null
                    ? `${hourLabel(h)}`
                    : `${hourLabel(h)}: ${clock(t)} local, ${working ? "within" : "outside"} 9 AM–5 PM`}
                </title>
              </rect>
            );
          })}
          <g transform={`translate(0 ${BAR_HEIGHT + BAR_GAP})`}>
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
                      disabled
                        ? "cursor-default"
                        : "cursor-pointer hover:fill-brand/40",
                      selected ? "fill-brand/30" : "fill-transparent",
                    )}
                    strokeWidth={0.4}
                  >
                    <title>{`${hourLabel(h)}: ${n.toLocaleString()} ${n === 1 ? "person" : "people"}`}</title>
                  </rect>
                  {dots(x, width, n).map((d, i) => (
                    <Tooltip key={i}>
                      <TooltipTrigger asChild>
                        <circle
                          cx={d.cx}
                          cy={d.cy}
                          r={d.r}
                          onClick={() => pick(h)}
                          className="fill-orange-500 stroke-background"
                          strokeWidth={0.3}
                        />
                      </TooltipTrigger>
                      <TooltipContent>
                        {people[h]?.[i] ?? "Unknown"}
                      </TooltipContent>
                    </Tooltip>
                  ))}
                  {names[h]?.map((name, i) => (
                    <text
                      key={name}
                      x={x + width / 2}
                      y={WORLD_VIEWBOX.height + 17 + i * 6}
                      textAnchor="middle"
                      className="pointer-events-none fill-muted-foreground text-[5px]"
                    >
                      {name}
                    </text>
                  ))}
                  {h % 3 === 0 && (
                    <text
                      x={x + width / 2}
                      y={WORLD_VIEWBOX.height + 10}
                      textAnchor="middle"
                      className={cn(
                        "pointer-events-none text-[7px]",
                        selected
                          ? "fill-foreground font-medium"
                          : "fill-muted-foreground",
                      )}
                    >
                      {h === 0 ? "0" : h > 0 ? `+${h}` : h}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </svg>

        <div className="grid grid-cols-2 gap-3">
          {(
            [
              ["From", from, (h: number) => onChange(h, to)],
              ["To", to, (h: number) => onChange(from, h)],
            ] as const
          ).map(([label, value, set]) => (
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
          {coverage !== null &&
            coverage.unknown > 0 &&
            ` ${coverage.unknown.toLocaleString()} with no time zone on record will not be invited.`}
          {anchor !== null && " Pick the other end of the range."}
        </p>
      </div>
    </TooltipProvider>
  );
}
