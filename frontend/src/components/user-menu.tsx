"use client";

import { Fragment, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarRange, ChevronDown, LogOut, ShieldCheck } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { THEME_OPTIONS, useThemeChoice } from "@/components/theme-toggle";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioIconItem,
  DropdownMenuSeparator,
  DropdownMenuSwitchItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { CalendarScope, SiteRole, ThemePreference } from "@/db/schema";
import type { BuildInfo } from "@/lib/build-info";
import { visibleSections } from "@/lib/nav";
import { SITE_ROLE_LABELS } from "@/lib/roles";
import { setCalendarScope } from "@/lib/user-settings";

/**
 * Group headings sit a size below the items they head and in the muted colour,
 * so they read as signposts rather than as rows that can be selected.
 */
const SECTION_HEADING =
  "px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground";

/**
 * The account menu, in the two places a menu is still the right shape.
 *
 * Below `lg` it is the whole of the app's navigation, because there is no
 * sidebar down there — every link, the calendar scope, appearance and signing
 * out. From `lg` up the sidebar has all of that, and this drops to
 * `accountOnly` mode as the trigger on the collapsed rail, where a 4rem column
 * has no room to show any of it inline.
 *
 * The links come from [[NAV_SECTIONS]] rather than being listed here, so a page
 * added to the sidebar cannot go missing on mobile.
 */
export function UserMenu({
  name,
  email,
  role,
  initialTheme,
  initialScope,
  build,
  signOutAction,
  accountOnly = false,
  variant = "header",
}: {
  name: string | null;
  email: string;
  role: SiteRole;
  initialTheme: ThemePreference;
  initialScope: CalendarScope;
  /** Which build is serving this page; stamped into the image at build time. */
  build: BuildInfo;
  /** Server action; it redirects, so it never resolves on the happy path. */
  signOutAction: () => Promise<void>;
  /**
   * Leave out the page links and the calendar scope, for when a sidebar beside
   * this menu is already showing them.
   */
  accountOnly?: boolean;
  /** `header`: the username and a chevron. `rail`: a square avatar button. */
  variant?: "header" | "rail";
}) {
  const router = useRouter();
  const { theme, choose } = useThemeChoice(initialTheme);
  const [scope, setScope] = useState<CalendarScope>(initialScope);
  const [, startTransition] = useTransition();

  function chooseScope(all: boolean) {
    const next: CalendarScope = all ? "all" : "own";
    setScope(next);
    // Unlike the theme, the new view is a different set of rows that only the
    // server can fetch, so the page is refreshed once the write lands.
    startTransition(async () => {
      await setCalendarScope(next);
      router.refresh();
    });
  }

  const elevated = role !== "operator";
  const sections = accountOnly ? [] : visibleSections(role);
  const rail = variant === "rail";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={rail ? (name ?? email) : undefined}
        className={
          rail
            ? "flex size-10 cursor-pointer items-center justify-center rounded-lg outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
            : "flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-sm text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
        }
      >
        {rail ? (
          <Avatar name={name} email={email} />
        ) : (
          <>
            {/* Tighter below `sm`, where this shares a 390px bar with the brand
                and the Workshops link and a long name pushed the bar wider than
                the screen. */}
            <span className="max-w-28 truncate sm:max-w-48">{name ?? email}</span>
            <ChevronDown className="size-4 shrink-0" />
          </>
        )}
      </DropdownMenuTrigger>

      {/*
        On the rail the menu opens sideways out of a 4rem column; in the header
        it hangs under a trigger near the right edge. `align="end"` keeps it
        inside the viewport in both cases.
      */}
      <DropdownMenuContent
        side={rail ? "right" : "bottom"}
        align="end"
        className="min-w-56"
      >
        <DropdownMenuLabel className="font-normal">
          <span className="block truncate font-medium">{name ?? email}</span>
          {name && (
            <span className="block truncate text-xs text-muted-foreground">{email}</span>
          )}
          {/* Only worth saying when it grants something — everyone is at
              least an operator, and a badge on every account is just noise. */}
          {elevated && (
            <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-medium text-brand">
              <ShieldCheck className="size-3" />
              {SITE_ROLE_LABELS[role]}
            </span>
          )}
        </DropdownMenuLabel>

        {/*
          A fragment rather than a wrapping element per section: the separators
          and headings belong to the menu's own flat sequence of rows, and
          boxing each group would put a div between the content and its items.
        */}
        {sections.map((section) => (
          <Fragment key={section.heading ?? "main"}>
            <DropdownMenuSeparator />
            {/* The first group is unheaded on purpose: an operator sees a plain
                list, and the headed group below reads as an addition to it. */}
            {section.heading && (
              <DropdownMenuLabel className={SECTION_HEADING}>
                {section.heading}
              </DropdownMenuLabel>
            )}
            {section.items.map((item) => (
              <DropdownMenuItem key={item.href} asChild>
                <Link href={item.href}>
                  <item.Icon />
                  {item.label}
                </Link>
              </DropdownMenuItem>
            ))}

            {section.control === "calendar-scope" && (
              <DropdownMenuSwitchItem
                checked={scope === "all"}
                onCheckedChange={chooseScope}
                // Keeps the menu open, so the calendar visibly swaps underneath
                // it and a mis-toggle can be undone without reopening.
                onSelect={(e) => e.preventDefault()}
              >
                <CalendarRange />
                Show all events
              </DropdownMenuSwitchItem>
            )}
          </Fragment>
        ))}

        <DropdownMenuSeparator />

        {/*
          Label and control on one line: three glyphs say as much as three
          labelled rows, and the setting is one people change rarely and
          recognise instantly.
        */}
        <div className="flex items-center justify-between gap-2 px-2 py-1.5">
          <span className="text-xs text-muted-foreground">Appearance</span>
          <DropdownMenuRadioGroup
            value={theme}
            onValueChange={choose}
            className="flex items-center gap-0.5 rounded-lg bg-muted p-0.5"
          >
            {THEME_OPTIONS.map(({ value, label, Icon }) => (
              <DropdownMenuRadioIconItem key={value} value={value} aria-label={label} title={label}>
                <Icon />
              </DropdownMenuRadioIconItem>
            ))}
          </DropdownMenuRadioGroup>
        </div>

        <DropdownMenuSeparator />

        {/*
          Fired from `onSelect` rather than from a form inside the item: Radix
          closes the menu on select, which would unmount a form before it could
          submit.
        */}
        <DropdownMenuItem onSelect={() => startTransition(() => void signOutAction())}>
          <LogOut />
          Sign out
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {/*
          A plain div, not a menu item: it is a fact to read, not something to
          select, and making it focusable would put a dead stop at the end of
          keyboard navigation through the menu.
        */}
        <div
          className="px-2 py-1 text-[11px] leading-tight text-muted-foreground"
          title={
            build.builtAt ? `Built ${build.builtAt} from ${build.tag}` : "Not a released build"
          }
        >
          <span className="font-mono">{build.tag}</span>
          {build.builtAtLabel && <span className="mt-0.5 block">built {build.builtAtLabel}</span>}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
