"use client";

/** The app's navigation sidebar, from lg up. */

import { useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { CalendarRange, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { UserMenu } from "@/components/user-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { CalendarScope, SiteRole, ThemePreference } from "@/db/schema";
import type { BuildInfo } from "@/lib/build-info";
import { isNavItemActive, visibleSections, type NavItem } from "@/lib/nav";
import { writeSidebarCookie } from "@/lib/sidebar";
import { setCalendarScope } from "@/lib/user-settings";
import { cn } from "@/lib/utils";

export function AppSidebar({
  name,
  email,
  role,
  initialTheme,
  initialScope,
  build,
  defaultCollapsed,
  sticky = false,
  signOutAction,
}: {
  name: string | null;
  email: string;
  role: SiteRole;
  initialTheme: ThemePreference;
  initialScope: CalendarScope;
  build: BuildInfo;
  defaultCollapsed: boolean;
  sticky?: boolean;
  signOutAction: () => Promise<void>;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const sections = visibleSections(role);

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
          {sections.map((section) => (
            <div key={section.heading ?? "main"} className="flex flex-col gap-0.5">
              {section.heading &&
                (collapsed ? (
                  <div aria-hidden className="mx-2 mb-2 border-t border-border/70" />
                ) : (
                  <h2 className="px-3 pb-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                    {section.heading}
                  </h2>
                ))}

              {section.items.map((item) => (
                <NavLink
                  key={item.href}
                  item={item}
                  active={isNavItemActive(pathname, item)}
                  collapsed={collapsed}
                />
              ))}

              {section.control === "calendar-scope" && (
                <ScopeSwitch initial={initialScope} collapsed={collapsed} />
              )}
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
            role={role}
            initialTheme={initialTheme}
            initialScope={initialScope}
            build={build}
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
  item: NavItem;
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

function ScopeSwitch({
  initial,
  collapsed,
}: {
  initial: CalendarScope;
  collapsed: boolean;
}) {
  const router = useRouter();
  const [scope, setScope] = useState<CalendarScope>(initial);
  const [, startTransition] = useTransition();
  const on = scope === "all";

  function flip() {
    const next: CalendarScope = on ? "own" : "all";
    setScope(next);
    startTransition(async () => {
      await setCalendarScope(next);
      router.refresh();
    });
  }

  const button = (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={collapsed ? "Show all events" : undefined}
      onClick={flip}
      className={cn(
        "flex h-10 w-full cursor-pointer items-center gap-3 rounded-lg text-sm outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50",
        collapsed ? "justify-center px-0" : "px-3",
        collapsed && on
          ? "bg-brand/10 text-brand"
          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
      )}
    >
      <CalendarRange className="size-4 shrink-0" />
      {!collapsed && (
        <>
          <span className="flex-1 truncate text-left">Show all events</span>
          <span
            aria-hidden
            className={cn(
              "flex h-4 w-7 shrink-0 items-center rounded-full p-0.5 transition-colors",
              on ? "bg-brand" : "bg-input",
            )}
          >
            <span
              className={cn(
                "size-3 rounded-full bg-background shadow-xs transition-transform duration-200 ease-out",
                on && "translate-x-3",
              )}
            />
          </span>
        </>
      )}
    </button>
  );

  if (!collapsed) return button;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="right">
        {on ? "Showing all events" : "Show all events"}
      </TooltipContent>
    </Tooltip>
  );
}
