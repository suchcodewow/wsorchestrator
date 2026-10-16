"use client";

/** The app's navigation sidebar, from lg up. */

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { PanelLeftClose, PanelLeftOpen, Star } from "lucide-react";
import { useFavoriteTabs } from "@/components/favorite-tabs";
import { UserMenu, type Impersonator } from "@/components/user-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ThemePreference } from "@/db/schema";
import type { BuildInfo } from "@/lib/build-info";
import { isNavItemActive, visibleSections, type NavItem } from "@/lib/nav";
import type { Access } from "@/lib/roles";
import { writeSidebarCookie } from "@/lib/sidebar";
import { cn } from "@/lib/utils";

export function AppSidebar({
  name,
  email,
  image,
  access,
  initialTheme,
  build,
  impersonator,
  defaultCollapsed,
  sticky = false,
  signOutAction,
}: {
  name: string | null;
  email: string;
  image: string | null;
  access: Access;
  initialTheme: ThemePreference;
  build: BuildInfo;
  impersonator: Impersonator | null;
  defaultCollapsed: boolean;
  sticky?: boolean;
  signOutAction: () => Promise<void>;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const sections = visibleSections(access);
  const favorites = useFavoriteTabs()?.tabs ?? [];

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    writeSidebarCookie(next ? "collapsed" : "expanded");
  }

  return (
    <TooltipProvider>
      <aside
        className={cn(
          "hidden shrink-0 flex-col overflow-hidden border-r border-border/70 bg-background/50 backdrop-blur-xl transition-[width] duration-200 ease-out lg:flex",
          collapsed ? "w-16" : "w-64",
          sticky && "lg:sticky lg:top-14 lg:h-[calc(100vh-3.5rem)] lg:self-start",
        )}
      >
        <nav className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-3 py-5">
          {favorites.length > 0 && (
            <div className="flex flex-col gap-0.5 rounded-xl bg-amber-400/10 py-2 ring-1 ring-amber-400/25">
              {collapsed ? (
                <Star aria-label="Favorites" className="mx-auto mb-1 size-3.5 fill-amber-400 text-amber-400" />
              ) : (
                <h2 className="flex items-center gap-1.5 px-3 pb-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                  <Star aria-hidden className="size-3 fill-amber-400 text-amber-400" />
                  Favorites
                </h2>
              )}

              {favorites.map((tab) => (
                <NavLink
                  key={tab.href}
                  item={{ href: tab.href, label: tab.label, Icon: Star }}
                  active={pathname === tab.href || pathname.startsWith(`${tab.href}/`)}
                  collapsed={collapsed}
                />
              ))}
            </div>
          )}

          {sections.map((section) => (
            <div key={section.heading} className="flex flex-col gap-0.5">
              {collapsed ? (
                <div aria-hidden className="mx-2 mb-2 border-t border-border/70" />
              ) : (
                <h2 className="px-3 pb-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                  {section.heading}
                </h2>
              )}

              {section.items.map((item) => (
                <NavLink
                  key={item.href}
                  item={item}
                  active={isNavItemActive(pathname, item)}
                  collapsed={collapsed}
                />
              ))}
            </div>
          ))}
        </nav>

        <div
          className={cn(
            "shrink-0 border-t border-border/70 p-2",
            collapsed && "flex justify-center",
          )}
        >
          <UserMenu
            name={name}
            email={email}
            image={image}
            access={access}
            initialTheme={initialTheme}
            build={build}
            impersonator={impersonator}
            signOutAction={signOutAction}
            accountOnly
            variant={collapsed ? "rail" : "sidebar"}
          />
        </div>

        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={cn(
            "flex h-10 shrink-0 cursor-pointer items-center gap-3 border-t border-border/70 px-3 text-sm text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset",
            collapsed && "justify-center",
          )}
        >
          {collapsed ? (
            <PanelLeftOpen className="size-4 shrink-0" />
          ) : (
            <PanelLeftClose className="size-4 shrink-0" />
          )}
          {!collapsed && <span>Collapse</span>}
        </button>
      </aside>
    </TooltipProvider>
  );
}

function NavLink({
  item,
  active,
  collapsed,
}: {
  item: Pick<NavItem, "href" | "label" | "Icon">;
  active: boolean;
  collapsed: boolean;
}) {
  const link = (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      aria-label={collapsed ? item.label : undefined}
      className={cn(
        "flex h-10 items-center gap-3 rounded-lg text-sm outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50",
        collapsed ? "justify-center px-0" : "px-3",
        active
          ? "bg-brand/10 font-medium text-brand"
          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
      )}
    >
      <item.Icon className="size-4 shrink-0" />
      {!collapsed && <span className="truncate">{item.label}</span>}
    </Link>
  );

  if (!collapsed) return link;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  );
}

