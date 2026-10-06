/** A placement level as a small coloured label. */

import type { Level } from "@/lib/iris/engine";
import { LEVEL_LABELS } from "@/lib/iris/subjects";
import { cn } from "@/lib/utils";

const TONE: Record<Level, string> = {
  1: "bg-amber-500/10 text-amber-700 ring-amber-500/20 dark:text-amber-300",
  2: "bg-sky-500/10 text-sky-700 ring-sky-500/20 dark:text-sky-300",
  3: "bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:text-emerald-300",
};

export function LevelBadge({ level, className }: { level: Level; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset",
        TONE[level],
        className,
      )}
    >
      {LEVEL_LABELS[level]}
    </span>
  );
}
