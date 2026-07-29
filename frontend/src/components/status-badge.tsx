import type { RunStatus } from "@/db/schema";
import { cn } from "@/lib/utils";

const LABELS: Record<RunStatus, string> = {
  scheduled: "Scheduled",
  requested: "Requested",
  provisioning: "Provisioning",
  applying: "Applying",
  ready: "Ready",
  destroying: "Destroying",
  destroyed: "Destroyed",
  failed: "Failed",
};

/**
 * Each status carries a dot colour and a tinted chip.
 *
 * Both schemes are defined deliberately: the light-mode `-100/-700` pairs on
 * their own rendered as glaring near-white blocks against a dark page. Dark
 * uses a translucent wash of the same hue, so the chip sits in the surface
 * rather than on top of it.
 *
 * Exported as a pair because the calendar draws the same dot without the chip,
 * and the two must never drift apart.
 */
const STYLES: Record<RunStatus, { chip: string; dot: string }> = {
  scheduled: {
    chip: "bg-violet-100 text-violet-700 dark:bg-violet-400/15 dark:text-violet-300",
    dot: "bg-violet-500",
  },
  requested: {
    chip: "bg-slate-100 text-slate-700 dark:bg-slate-400/15 dark:text-slate-300",
    dot: "bg-slate-400",
  },
  provisioning: {
    chip: "bg-blue-100 text-blue-700 dark:bg-blue-400/15 dark:text-blue-300",
    dot: "bg-blue-500",
  },
  applying: {
    chip: "bg-amber-100 text-amber-800 dark:bg-amber-400/15 dark:text-amber-300",
    dot: "bg-amber-500",
  },
  ready: {
    chip: "bg-emerald-100 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300",
    dot: "bg-emerald-500",
  },
  destroying: {
    chip: "bg-orange-100 text-orange-700 dark:bg-orange-400/15 dark:text-orange-300",
    dot: "bg-orange-500",
  },
  destroyed: {
    chip: "bg-slate-100 text-slate-500 dark:bg-slate-400/10 dark:text-slate-400",
    dot: "bg-slate-300 dark:bg-slate-600",
  },
  failed: {
    chip: "bg-red-100 text-red-700 dark:bg-red-400/15 dark:text-red-300",
    dot: "bg-red-500",
  },
};

/** Statuses where work is still in flight, and the dot should pulse. */
const ACTIVE: RunStatus[] = [
  "requested",
  "provisioning",
  "applying",
  "destroying",
];

export function statusDot(status: RunStatus): string {
  return STYLES[status].dot;
}

export function isActiveStatus(status: RunStatus): boolean {
  return ACTIVE.includes(status);
}

export function StatusBadge({ status }: { status: RunStatus }) {
  const { chip, dot } = STYLES[status];

  return (
    <span
      className={cn(
        "inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap",
        chip,
      )}
    >
      <span className="relative flex size-1.5">
        {/* An expanding echo behind the dot, so in-flight runs read as live. */}
        {isActiveStatus(status) && (
          <span
            className={cn(
              "absolute inline-flex size-full animate-ping rounded-full opacity-75",
              dot,
            )}
          />
        )}
        <span className={cn("relative inline-flex size-1.5 rounded-full", dot)} />
      </span>
      {LABELS[status]}
    </span>
  );
}
