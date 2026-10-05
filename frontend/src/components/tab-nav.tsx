"use client";

/** A row of tabs across the top of a settings section. */

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type TabItem = {
  href: string;
  label: string;
  Icon: LucideIcon;
  /** How many the tab holds, shown after its label. */
  count?: number;
};

export function TabNav({
  tabs,
  label,
}: {
  tabs: readonly TabItem[];
  label: string;
}) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-wrap gap-1 border-b" aria-label={label}>
      {tabs.map(({ href, label: text, Icon, count }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-2 border-b-2 px-3 py-2 text-sm transition-colors",
              active
                ? "border-brand text-foreground"
                : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
            )}
          >
            <Icon className="size-4" />
            {text}
            {count !== undefined && (
              <span
                className={cn(
                  "rounded-full px-1.5 py-px text-xs font-medium tabular-nums",
                  active ? "bg-brand-subtle text-brand" : "bg-muted text-muted-foreground",
                )}
              >
                {count.toLocaleString()}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
