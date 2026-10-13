/** A row of filter chips, each a link, the current one marked. */

import Link from "next/link";
import { cn } from "@/lib/utils";

export type Chip = { href: string; label: string; active: boolean };

export function ChipNav({ chips, label }: { chips: Chip[]; label: string }) {
  return (
    <nav className="flex flex-wrap gap-1.5" aria-label={label}>
      {chips.map((c) => (
        <Link
          key={c.href}
          href={c.href}
          scroll={false}
          aria-current={c.active ? "page" : undefined}
          className={cn(
            "rounded-full border px-3 py-1 text-sm transition-colors",
            c.active ? "border-brand bg-brand-subtle text-brand" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
          )}
        >
          {c.label}
        </Link>
      ))}
    </nav>
  );
}
