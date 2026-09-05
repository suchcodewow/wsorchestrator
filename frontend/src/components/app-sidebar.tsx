"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  CalendarRange,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  ShieldCheck,
} from "lucide-react";
import { Avatar } from "@/components/avatar";
import { ThemeToggle, useThemeChoice } from "@/components/theme-toggle";
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
import { SITE_ROLE_LABELS } from "@/lib/roles";
import { writeSidebarCookie } from "@/lib/sidebar";
import { setCalendarScope } from "@/lib/user-settings";
import { cn } from "@/lib/utils";

/**
 * The app's navigation, from `lg` up.
 *
 * Below `lg` this renders nothing and the dropdown under the username carries
 * everything instead — see [[UserMenu]]. That split, rather than a drawer that
 * slides over the page, is deliberate: the phone-sized case here is an operator
 * checking a run, and a 16rem panel over a 375px screen leaves no page behind
 * it worth revealing.
 *
 * Collapsed, the sidebar is a rail of icons rather than nothing at all, so
 * every destination stays one click away and the pane beside it still gains
 * 12rem. The state arrives from a cookie the server has already read, so the
 * first paint is the right width — a `useState(false)` here would render 16rem
 * and snap to 4rem on hydration for anyone who had collapsed it.
 */
export function AppSidebar({
  name,
  email,
  role,
  initialTheme,
  initialScope,
  build,
  defaultCollapsed,
  signOutAction,
}: {
  name: string | null;
  email: string;
  role: SiteRole;
  initialTheme: ThemePreference;
  initialScope: CalendarScope;
  /** Which build is serving this page; stamped into the image at build time. */
  build: BuildInfo;
  /** From the sidebar cookie, so the server and the first client paint agree. */
  defaultCollapsed: boolean;
  /** Server action; it redirects, so it never resolves on the happy path. */
  signOutAction: () => Promise<void>;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const sections = visibleSections(role);

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    // Written from here rather than through a server action: it is a cookie the
    // next *server* render needs, and a round trip would only delay a width the
    // browser has already animated.
    writeSidebarCookie(next ? "collapsed" : "expanded");
  }

  return (
    <TooltipProvider>
      <aside
        // Translucent over the ambient backdrop, matching the header rather than
        // sitting on bare gradient: the blooms are strongest in the lower left,
        // which is exactly where the account footer is, and unbacked text over
        // them was the one part of this that read as muddy.
        //
        // `overflow-hidden` so nothing can spill sideways mid-transition; the
        // nav inside it does its own vertical scrolling.
        className={cn(
          "hidden shrink-0 flex-col overflow-hidden border-r border-border/70 bg-background/50 backdrop-blur-xl transition-[width] duration-200 ease-out lg:flex",
          collapsed ? "w-16" : "w-64",
        )}
      >
        <nav className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-3 py-5">
          {sections.map((section) => (
            <div key={section.heading ?? "main"} className="flex flex-col gap-0.5">
              {section.heading &&
                (collapsed ? (
                  // A rule instead of the word: the heading cannot be read at
                  // 4rem, but the break between the two groups still carries
                  // meaning and losing it would make the rail one long list.
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

        <AccountFooter
          name={name}
          email={email}
          role={role}
          initialTheme={initialTheme}
          initialScope={initialScope}
          build={build}
          collapsed={collapsed}
          signOutAction={signOutAction}
        />

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

/**
 * One destination. Collapsed, the label becomes a tooltip — it is the only
 * thing naming the icon, so it is also the accessible name via `aria-label`
 * rather than being left to the tooltip alone.
 */
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
        // Tinted rather than filled: one solid brand block in a column of
        // otherwise quiet rows shouts, and the point is only "you are here".
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

/**
 * Whose events the calendar shows.
 *
 * A switch and not a link, so it is the one row in the sidebar that changes
 * something instead of going somewhere — hence its own heading rather than a
 * place in the list above. Collapsed it becomes a toggle that shows its state
 * by being lit, which is all a 4rem rail has room to say.
 */
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
    // Unlike the theme, the new view is a different set of rows that only the
    // server can fetch, so the page is refreshed once the write lands.
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
          {/* Decorative: `aria-checked` on the button already carries the state. */}
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

/**
 * Who is signed in, and the two things that belong to them rather than to a
 * page: appearance and signing out.
 *
 * Expanded it is inline — the controls are worth a row each at 16rem, and a
 * dropdown to reach a three-glyph toggle is a click spent on nothing.
 * Collapsed there is no room for any of it, so it becomes the same
 * [[UserMenu]] the mobile header uses, in `accountOnly` mode because the rail
 * above is already showing every link that menu would otherwise list.
 */
function AccountFooter({
  name,
  email,
  role,
  initialTheme,
  initialScope,
  build,
  collapsed,
  signOutAction,
}: {
  name: string | null;
  email: string;
  role: SiteRole;
  initialTheme: ThemePreference;
  initialScope: CalendarScope;
  build: BuildInfo;
  collapsed: boolean;
  signOutAction: () => Promise<void>;
}) {
  const { theme, choose } = useThemeChoice(initialTheme);
  const [, startTransition] = useTransition();

  // Only worth saying when it grants something — everyone is at least an
  // operator, and a badge on every account is just noise.
  const elevated = role !== "operator";

  if (collapsed) {
    return (
      <div className="flex shrink-0 justify-center border-t border-border/70 px-3 py-3">
        <UserMenu
          name={name}
          email={email}
          role={role}
          initialTheme={initialTheme}
          initialScope={initialScope}
          build={build}
          signOutAction={signOutAction}
          accountOnly
          variant="rail"
        />
      </div>
    );
  }

  return (
    <div className="flex shrink-0 flex-col gap-3 border-t border-border/70 px-3 py-3">
      <div className="flex items-center gap-2.5 px-1">
        <Avatar name={name} email={email} />
        <div className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{name ?? email}</span>
          {name && (
            <span className="block truncate text-xs text-muted-foreground">{email}</span>
          )}
        </div>
      </div>

      {elevated && (
        <span className="inline-flex w-fit items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-medium text-brand">
          <ShieldCheck className="size-3" />
          {SITE_ROLE_LABELS[role]}
        </span>
      )}

      {/* Label and control on one line: three glyphs say as much as three
          labelled rows, and the setting is one people change rarely and
          recognise instantly. */}
      <div className="flex items-center justify-between gap-2 px-1">
        <span className="text-xs text-muted-foreground">Appearance</span>
        <ThemeToggle value={theme} onChange={choose} />
      </div>

      <button
        type="button"
        onClick={() => startTransition(() => void signOutAction())}
        className="flex h-9 cursor-pointer items-center gap-3 rounded-lg px-3 text-sm text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <LogOut className="size-4 shrink-0" />
        Sign out
      </button>

      {/* A fact to read, not something to select. */}
      <div
        className="px-1 text-[11px] leading-tight text-muted-foreground"
        title={
          build.builtAt ? `Built ${build.builtAt} from ${build.tag}` : "Not a released build"
        }
      >
        <span className="font-mono">{build.tag}</span>
        {build.builtAtLabel && <span className="mt-0.5 block">built {build.builtAtLabel}</span>}
      </div>
    </div>
  );
}
