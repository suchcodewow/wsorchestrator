"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A row of tabs across the top of a settings section.
 *
 * Links, not local state: each tab is its own route, so it fetches its own data
 * on the server and can be opened, bookmarked, and linked to directly. The cost
 * is a navigation per tab — which Next has already prefetched — and the benefit
 * is that adding the next tab is adding a folder rather than threading another
 * slice of state through a client component that owns all of them.
 *
 * Shared by My settings and the admin settings, which is why the tab list is a
 * prop: the two sections have nothing in common but this row, and a second copy
 * of it would be the thing that quietly stops matching.
 *
 * That prop must be passed by a *client* component. `Icon` is a React component,
 * and a server layout rendering `<TabNav tabs={...}>` hands functions across the
 * boundary — React refuses it at request time ("Functions cannot be passed
 * directly to Client Components"), which nothing in a typecheck or a lint can
 * see. Hence the one-line `settings-tabs.tsx` in each section: it imports its
 * list on the client, and the layouts render it with no props.
 */

export type TabItem = {
  href: string;
  label: string;
  Icon: LucideIcon;
};

export function TabNav({
  tabs,
  /** Names the navigation for a screen reader — "My settings", "Site settings". */
  label,
}: {
  tabs: readonly TabItem[];
  label: string;
}) {
  const pathname = usePathname();

  return (
    // No negative bottom margin to lap the border, tempting as it looks: Tailwind
    // v4's `space-y-*` spaces children with `margin-bottom`, so a `-mb-px` here
    // silently replaces the layout's gap and the panel lands against the tabs.
    <nav className="flex flex-wrap gap-1 border-b" aria-label={label}>
      {tabs.map(({ href, label: text, Icon }) => {
        // Prefix rather than equality, so a tab stays lit on its own subpages.
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
          </Link>
        );
      })}
    </nav>
  );
}
