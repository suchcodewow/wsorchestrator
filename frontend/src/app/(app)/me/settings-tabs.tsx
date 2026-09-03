"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { MY_SETTINGS_TABS } from "./tabs";

/**
 * The tabs across the top of My settings.
 *
 * Links, not local state: each tab is its own route, so it fetches its own data
 * on the server and can be opened, bookmarked, and linked to directly. The cost
 * is a navigation per tab — which Next has already prefetched — and the benefit
 * is that adding the next tab is adding a folder rather than threading another
 * slice of state through a client component that owns all of them.
 */
export function SettingsTabs() {
  const pathname = usePathname();

  return (
    // No negative bottom margin to lap the border, tempting as it looks: Tailwind
    // v4's `space-y-*` spaces children with `margin-bottom`, so a `-mb-px` here
    // silently replaces the layout's gap and the panel lands against the tabs.
    <nav className="flex gap-1 border-b" aria-label="My settings">
      {MY_SETTINGS_TABS.map(({ href, label, Icon }) => {
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
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
