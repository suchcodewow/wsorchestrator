"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Blocks,
  CalendarRange,
  ChevronDown,
  Cloud,
  DatabaseBackup,
  Laptop,
  LogOut,
  Moon,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  Terminal,
  UserCog,
  UsersRound,
} from "lucide-react";
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
import {
  THEME_PREFERENCES,
  type CalendarScope,
  type SiteRole,
  type ThemePreference,
} from "@/db/schema";
import type { BuildInfo } from "@/lib/build-info";
import {
  SITE_ROLE_LABELS,
  canAuditProjects,
  canManageBackups,
  canManageSettings,
  canManageUsers,
  canRunSql,
  canSeeAllEvents,
} from "@/lib/roles";
import { setCalendarScope, setThemePreference } from "@/lib/user-settings";
import { applyTheme } from "@/lib/theme";

const THEME_OPTIONS: {
  value: ThemePreference;
  label: string;
  Icon: typeof Sun;
}[] = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System default", Icon: Laptop },
];

/**
 * Group headings sit a size below the items they head and in the muted colour,
 * so they read as signposts rather than as rows that can be selected.
 */
const SECTION_HEADING =
  "px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground";

export function UserMenu({
  name,
  email,
  role,
  initialTheme,
  initialScope,
  build,
  signOutAction,
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
}) {
  const router = useRouter();
  const [theme, setTheme] = useState<ThemePreference>(initialTheme);
  const [scope, setScope] = useState<CalendarScope>(initialScope);
  const [, startTransition] = useTransition();

  // Live OS-change following for `system` lives in ThemeSync (root layout), so
  // it works on every page rather than only where this menu is mounted.

  function choose(value: string) {
    // Radix hands back a plain string; narrow it before it goes any further.
    if (!THEME_PREFERENCES.includes(value as ThemePreference)) return;
    const preference = value as ThemePreference;

    setTheme(preference);
    // Repaint immediately rather than waiting on the round trip — the write is
    // only about surviving a reload, and the menu should never feel laggy.
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

  // Each group is drawn only when the role unlocks something inside it, so a
  // heading never stands over an empty section. The items are still gated one
  // by one below: the checks agree today, but the group flag is about the
  // heading, not about who may open any particular page.
  const showManagement = canSeeAllEvents(role);
  const showAdministration =
    canManageUsers(role) ||
    canManageBackups(role) ||
    canRunSql(role) ||
    canAuditProjects(role) ||
    canManageSettings(role);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-sm text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50">
        <span className="max-w-48 truncate">{name ?? email}</span>
        <ChevronDown className="size-4 shrink-0" />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuLabel className="font-normal">
          <span className="block truncate font-medium">{name ?? email}</span>
          {name && (
            <span className="block truncate text-xs text-muted-foreground">
              {email}
            </span>
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

        <DropdownMenuSeparator />

        {/*
          Everything every account can do comes first and unheaded: an operator
          sees a plain list, and the headed groups below read as additions to it
          rather than as one category among three.
        */}
        <DropdownMenuItem asChild>
          <Link href="/events">
            <Settings />
            Open orchestrator
          </Link>
        </DropdownMenuItem>

        {/*
          Unheaded and ungated, alongside the orchestrator: contributing
          components is the floor permission, not a privilege. What a
          contribution can reach is decided at review, so there is nothing to
          gate here.
        */}
        <DropdownMenuItem asChild>
          <Link href="/contribute">
            <Blocks />
            Contribute
          </Link>
        </DropdownMenuItem>

        {/*
          Also unheaded and ungated: this account's own configuration — the
          Harness tokens it has saved — which is not a privilege and not the
          site's. The "Admin settings" item below is the site's, and the labels
          are what keep the two apart.
        */}
        <DropdownMenuItem asChild>
          <Link href="/me">
            <UserCog />
            My settings
          </Link>
        </DropdownMenuItem>

        {showManagement && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className={SECTION_HEADING}>
              Management
            </DropdownMenuLabel>
            {canSeeAllEvents(role) && (
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
          </>
        )}

        {showAdministration && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className={SECTION_HEADING}>
              Administration
            </DropdownMenuLabel>
            {canManageUsers(role) && (
              <DropdownMenuItem asChild>
                <Link href="/users">
                  <UsersRound />
                  Manage users
                </Link>
              </DropdownMenuItem>
            )}
            {canManageBackups(role) && (
              <DropdownMenuItem asChild>
                <Link href="/backups">
                  <DatabaseBackup />
                  Backups
                </Link>
              </DropdownMenuItem>
            )}
            {canRunSql(role) && (
              <DropdownMenuItem asChild>
                <Link href="/database">
                  <Terminal />
                  Database
                </Link>
              </DropdownMenuItem>
            )}
            {canAuditProjects(role) && (
              <DropdownMenuItem asChild>
                <Link href="/cloud-status">
                  <Cloud />
                  Cloud Status
                </Link>
              </DropdownMenuItem>
            )}
            {canManageSettings(role) && (
              // "Admin" in the label because the theme and calendar controls
              // below are settings too, and the two are not the same thing:
              // one is this account's, this one is the whole site's.
              <DropdownMenuItem asChild>
                <Link href="/settings">
                  <SlidersHorizontal />
                  Admin settings
                </Link>
              </DropdownMenuItem>
            )}
          </>
        )}

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
              <DropdownMenuRadioIconItem
                key={value}
                value={value}
                aria-label={label}
                title={label}
              >
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
        <DropdownMenuItem
          onSelect={() => startTransition(() => void signOutAction())}
        >
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
            build.builtAt
              ? `Built ${build.builtAt} from ${build.tag}`
              : "Not a released build"
          }
        >
          <span className="font-mono">{build.tag}</span>
          {build.builtAtLabel && (
            <span className="mt-0.5 block">built {build.builtAtLabel}</span>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
