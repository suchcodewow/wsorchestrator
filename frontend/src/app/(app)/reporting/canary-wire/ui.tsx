/**
 * The Canary Wire page's shared pieces, in the app's own vocabulary: the
 * pill buttons Bootcamp History filters with, and the status colours the run
 * chips use, so a completed square is the same green as a ready workshop.
 */

import type { StateClass } from "@/lib/canary-wire/report";
import { formatPct } from "@/lib/canary-wire/report";
import { cn } from "@/lib/utils";

export const PILL = cn(
  "inline-flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-full border bg-card px-3.5 text-sm whitespace-nowrap text-muted-foreground shadow-sm outline-none transition-colors",
  "hover:bg-muted/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
  "[&_svg]:size-4 [&_svg]:shrink-0",
);

/** A pill that is switched on, as Bootcamp History's chosen status is. */
export const PILL_ON = "border-brand-border bg-brand-subtle text-foreground [&_svg]:text-brand";

export const SELECT_PILL = cn(
  "h-9 cursor-pointer rounded-full border bg-card pr-8 pl-3.5 text-sm font-medium text-foreground shadow-sm outline-none",
  "focus-visible:ring-2 focus-visible:ring-ring/50 dark:bg-card",
);

/** A rounded chip, as a run's status is shown. */
export const CHIP = "inline-flex w-fit shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap";

export const FILL: Record<StateClass, string> = {
  completed: "bg-emerald-500",
  progress: "bg-amber-500",
  notstarted: "bg-red-500",
  blank: "bg-muted",
};

/**
 * Work we can see but don't count — another role's module, or a rep who is
 * pre-bootcamp — shares one treatment, because to a reader both mean "this
 * happened, and it isn't in the rate": the counted square's hue, washed out
 * and dashed. The tooltip still says which, since the follow-up differs.
 */
export const UNCOUNTED: Record<StateClass, string> = {
  completed: "border-2 border-dashed border-emerald-400 bg-emerald-500/10",
  progress: "border-2 border-dashed border-amber-400 bg-amber-500/10",
  notstarted: "border-2 border-dashed border-muted-foreground/30 bg-card",
  blank: "border-2 border-dashed border-muted-foreground/30 bg-card",
};

function barColor(v: number | null): string {
  if (v === null) return "bg-muted";
  if (v < 50) return "bg-red-500";
  if (v < 80) return "bg-amber-500";
  return "bg-emerald-500";
}

/** A rate and its bar; red under 50%, amber under 80%. */
export function Meter({ value, className }: { value: number | null; className?: string }) {
  return (
    <span className={cn("flex items-center justify-end gap-2", className)}>
      <span className="min-w-12 text-right font-medium tabular-nums">{formatPct(value)}</span>
      <span className="h-1.5 w-14 shrink-0 overflow-hidden rounded-full bg-muted">
        <i className={cn("block h-full rounded-full", barColor(value))} style={{ width: `${value ?? 0}%` }} />
      </span>
    </span>
  );
}
