/** How far someone has got with an item: a dot on a card, a badge in a table. */

import { TIER_LABELS, type Tier } from "@/lib/mimir/kinds";
import { cn } from "@/lib/utils";

const DOT: Record<Tier, string> = {
  none: "bg-muted-foreground/25",
  viewed: "bg-amber-500",
  practiced: "bg-brand",
  mastered: "bg-emerald-500",
};

const BADGE: Record<Tier, string> = {
  none: "bg-muted text-muted-foreground",
  viewed: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  practiced: "bg-brand-subtle text-brand",
  mastered: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
};

export function TierDot({ tier, className }: { tier: Tier; className?: string }) {
  return (
    <span
      title={TIER_LABELS[tier]}
      aria-label={TIER_LABELS[tier]}
      className={cn("inline-block size-2 shrink-0 rounded-full", DOT[tier], className)}
    />
  );
}

export function TierBadge({ tier, children }: { tier: Tier; children?: React.ReactNode }) {
  return (
    <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", BADGE[tier])}>
      {children ?? TIER_LABELS[tier]}
    </span>
  );
}
