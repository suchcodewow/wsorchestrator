"use client";

/** A row of tabs across the top of a settings section. */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Star, type LucideIcon } from "lucide-react";
import { useFavoriteTabs } from "@/components/favorite-tabs";
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
  const favorites = useFavoriteTabs();

  // Every section's layout stacks heading, tabs and content in `space-y-8`.
  // The tabs sit closer to the heading above (-mt-4) and a little closer to
  // the content below (mb-6); framed, the heading is hidden, so no pull-up.
  return (
    <nav
      className="-mt-4 mb-6 flex flex-wrap gap-1 border-b framed:mt-0"
      aria-label={label}
      data-tab-nav=""
    >
      {tabs.map(({ href, label: text, Icon, count }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        const starred = favorites?.has(href) ?? false;
        return (
          <div
            key={href}
            className={cn(
              "flex items-center border-b-2 transition-colors",
              active
                ? "border-brand text-foreground"
                : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
            )}
          >
            <Link
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-2 py-2 pl-3 text-sm",
                favorites ? "pr-1" : "pr-3",
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
            {favorites && (
              <button
                type="button"
                onClick={() => favorites.toggle({ href, label: text })}
                aria-pressed={starred}
                aria-label={starred ? `Remove ${text} from favorites` : `Add ${text} to favorites`}
                title={starred ? "Remove from favorites" : "Add to favorites"}
                className="mr-1.5 cursor-pointer rounded p-1 outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <Star
                  className={cn(
                    "size-3.5",
                    starred
                      ? "fill-amber-400 text-amber-400"
                      : "text-muted-foreground/60 hover:text-muted-foreground",
                  )}
                />
              </button>
            )}
          </div>
        );
      })}
    </nav>
  );
}
