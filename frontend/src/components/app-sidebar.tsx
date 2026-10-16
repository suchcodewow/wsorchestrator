"use client";

/** The app's navigation sidebar, from lg up. */

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { PanelLeftClose, PanelLeftOpen, Settings, Star } from "lucide-react";
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
import { favoriteIcon } from "@/lib/favorite-icons";
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
  // Settings pages with a gear on their entry have no row of their own, except in the collapsed rail, which has no gear.
  const gearPages = new Set(sections.flatMap((sec) => sec.items.flatMap((i) => (i.settings ? [i.settings] : []))));
  // On a settings page that has a gear, its parent's row is the selected one and shows the gear.
  const onSettings = (item: NavItem) =>
    !collapsed && !!item.settings && gearPages.has(item.settings) && (pathname === item.settings || pathname.startsWith(`${item.settings}/`));
  const favoriteTabs = useFavoriteTabs();
  const favorites = favoriteTabs?.tabs ?? [];

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
            <div className="flex flex-col gap-0.5">
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
                  item={{ href: tab.href, label: tab.label, Icon: favoriteIcon(tab.href) ?? Star }}
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

              {section.items.filter((item) => collapsed || !gearPages.has(item.href)).map((item) => (
                <NavLink
                  key={item.href}
                  item={item}
                  active={isNavItemActive(pathname, item) || onSettings(item)}
                  onSettings={onSettings(item)}
                  collapsed={collapsed}
                  settings={item.settings && sections.some((sec) => sec.items.some((i) => i.href === item.settings)) ? item.settings : undefined}
                  starred={favoriteTabs?.has(item.href)}
                  onStar={
                    favoriteTabs && !item.hasTabs ? () => favoriteTabs.toggle({ href: item.href, label: item.label }) : undefined
                  }
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
  settings,
  onSettings = false,
  starred = false,
  onStar,
}: {
  item: Pick<NavItem, "href" | "label" | "Icon">;
  active: boolean;
  collapsed: boolean;
  /** Where its settings are, when this person may open them: the icon becomes a gear to there on hover. */
  settings?: string;
  /** The page open is that settings page: the gear stays shown in place of the icon. */
  onSettings?: boolean;
  starred?: boolean;
  /** Adds or removes it from the favorites; none for an entry that cannot be starred. */
  onStar?: () => void;
}) {
  const link = (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      aria-label={collapsed ? item.label : undefined}
      className={cn(
        "flex h-10 items-center gap-[15px] rounded-lg text-sm outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50",
        // The icon is centred at 17px, where the settings gear's strip centres its own.
        collapsed ? "justify-center px-0" : onStar ? "pr-9 pl-[9px]" : "pr-3 pl-[9px]",
        active
          ? "bg-brand/10 font-medium text-brand"
          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground group-hover/nav:bg-accent group-hover/nav:text-accent-foreground",
      )}
    >
      <item.Icon className={cn("size-4 shrink-0", settings && !collapsed && (onSettings ? "opacity-0" : "group-hover/nav:opacity-0 group-has-[[data-gear]:focus-visible]/nav:opacity-0"))} />
      {!collapsed && <span className="truncate">{item.label}</span>}
    </Link>
  );

  if (!collapsed) {
    if (!onStar && !settings) return link;
    return (
      <div className="group/nav relative">
        {link}
        {settings && (
          <Link
            href={settings}
            aria-label={`${item.label} settings`}
            title={`${item.label} settings`}
            data-gear
            className={cn("absolute inset-y-0 left-0 flex w-[34px] items-center justify-center rounded-l-lg bg-foreground/10 text-muted-foreground opacity-0 outline-none transition-opacity hover:bg-foreground/15 hover:text-foreground focus-visible:opacity-100 focus-visible:ring-[3px] focus-visible:ring-ring/50 group-hover/nav:opacity-100", onSettings && "opacity-100")}
          >
            <Settings className="size-4" />
          </Link>
        )}
        {onStar && (
        <button
          type="button"
          onClick={onStar}
          aria-pressed={starred}
          aria-label={starred ? `Remove ${item.label} from favorites` : `Add ${item.label} to favorites`}
          title={starred ? "Remove from favorites" : "Add to favorites"}
          className={cn(
            "absolute top-1/2 right-2 -translate-y-1/2 cursor-pointer rounded p-1 outline-none transition-opacity hover:bg-accent focus-visible:opacity-100 focus-visible:ring-[3px] focus-visible:ring-ring/50",
            starred ? "opacity-100" : "opacity-0 group-hover/nav:opacity-100",
          )}
        >
          <Star className={cn("size-3.5", starred ? "fill-amber-400 text-amber-400" : "text-muted-foreground")} />
        </button>
        )}
      </div>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  );
}

