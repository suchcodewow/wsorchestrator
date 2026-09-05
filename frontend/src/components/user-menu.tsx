"use client";

import { Fragment, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CalendarRange,
  ChevronDown,
  ChevronsUpDown,
  Laptop,
  LogOut,
  Moon,
  ShieldCheck,
  Sun,
  type LucideIcon,
} from "lucide-react";
import { Avatar } from "@/components/avatar";
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
import { THEME_PREFERENCES, type CalendarScope, type SiteRole, type ThemePreference } from "@/db/schema";
import type { BuildInfo } from "@/lib/build-info";
import { visibleSections } from "@/lib/nav";
import { SITE_ROLE_LABELS } from "@/lib/roles";
import { applyTheme } from "@/lib/theme";
import { setCalendarScope, setThemePreference } from "@/lib/user-settings";

/**
 * Group headings sit a size below the items they head and in the muted colour,
 * so they read as signposts rather than as rows that can be selected.
 */
const SECTION_HEADING =
  "px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground";

const THEME_OPTIONS: { value: ThemePreference; label: string; Icon: LucideIcon }[] = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System default", Icon: Laptop },
];

/**
 * Where this menu can be opened from, and what its trigger looks like there.
 *
 * `header`: the username and a chevron, in the bar — below `lg`, or on the
 * pages that have no sidebar. `sidebar`: the account row in the sidebar footer.
 * `rail`: the same row with only room for an avatar, once the sidebar is
 * collapsed.
 */
export type MenuVariant = "header" | "sidebar" | "rail";

const TRIGGER_CLASS: Record<MenuVariant, string> = {
  header:
    "flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-sm text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50",
  sidebar:
    "flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50",
  rail: "flex size-10 cursor-pointer items-center justify-center rounded-lg outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50",
};

/**
 * The account menu, everywhere one is opened.
 *
 * Below `lg` it is the whole of the app's navigation, because there is no
 * sidebar down there — every link, the calendar scope, appearance and signing
 * out. From `lg` up the sidebar lists the links itself, and this drops to
 * `accountOnly`: what is left is what belongs to the person rather than to a
 * page, opened from their name in the sidebar footer.
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
  /** Where this is being opened from; see [[MenuVariant]]. */
  variant?: MenuVariant;
}) {
  const router = useRouter();
  const [theme, setTheme] = useState<ThemePreference>(initialTheme);
  const [scope, setScope] = useState<CalendarScope>(initialScope);
  const [, startTransition] = useTransition();

  function chooseTheme(value: string) {
    // Radix hands back a plain string; narrow it before it goes any further.
    if (!THEME_PREFERENCES.includes(value as ThemePreference)) return;
    const preference = value as ThemePreference;

    setTheme(preference);
    // Repaint immediately rather than waiting on the round trip — the write is
    // only about surviving a reload, and the control should never feel laggy.
    // Following a later OS change for `system` is ThemeSync's job in the root
    // layout, so it works on every page and not only where a control is open.
    applyTheme(preference);
    startTransition(() => {
      void setThemePreference(preference);
    });
  }

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

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        // Nothing but a picture of an initial names the rail's trigger.
        aria-label={variant === "rail" ? (name ?? email) : undefined}
        className={TRIGGER_CLASS[variant]}
      >
        {variant === "header" && (
          <>
            {/* Tighter below `sm`, where a long name in a 390px bar pushed the
                bar — and with it the whole document — wider than the screen. */}
            <span className="max-w-28 truncate sm:max-w-48">{name ?? email}</span>
            <ChevronDown className="size-4 shrink-0" />
          </>
        )}

        {variant === "rail" && <Avatar name={name} email={email} />}

        {/*
          Spans rather than divs: the trigger is a `button`, whose content model
          is phrasing content only.
        */}
        {variant === "sidebar" && (
          <>
            <Avatar name={name} email={email} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{name ?? email}</span>
              {name && (
                <span className="block truncate text-xs text-muted-foreground">{email}</span>
              )}
            </span>
            {/* Not a direction: this opens to the right, or upward if that is
                where the room is, and Radix decides which at open time. */}
            <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
          </>
        )}
      </DropdownMenuTrigger>

      {/*
        Out of the sidebar it opens sideways so it never covers the nav it was
        opened from; in the header it hangs under a trigger near the right edge.
        `align="end"` keeps it inside the viewport in both cases.
      */}
      <DropdownMenuContent
        side={variant === "header" ? "bottom" : "right"}
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
            onValueChange={chooseTheme}
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
