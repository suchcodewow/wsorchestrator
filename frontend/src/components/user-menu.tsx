"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CalendarRange,
  ChevronDown,
  Laptop,
  LogOut,
  Moon,
  Settings,
  ShieldCheck,
  Sun,
  UsersRound,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  THEME_PREFERENCES,
  type CalendarScope,
  type SiteRole,
  type ThemePreference,
} from "@/db/schema";
import { SITE_ROLE_LABELS, canManageUsers, canSeeAllEvents } from "@/lib/roles";
import { setCalendarScope, setThemePreference } from "@/lib/user-settings";
import { DARK_QUERY, applyTheme } from "@/lib/theme";

const THEME_OPTIONS: {
  value: ThemePreference;
  label: string;
  Icon: typeof Sun;
}[] = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System default", Icon: Laptop },
];

export function UserMenu({
  name,
  email,
  role,
  initialTheme,
  initialScope,
  signOutAction,
}: {
  name: string | null;
  email: string;
  role: SiteRole;
  initialTheme: ThemePreference;
  initialScope: CalendarScope;
  /** Server action; it redirects, so it never resolves on the happy path. */
  signOutAction: () => Promise<void>;
}) {
  const router = useRouter();
  const [theme, setTheme] = useState<ThemePreference>(initialTheme);
  const [scope, setScope] = useState<CalendarScope>(initialScope);
  const [, startTransition] = useTransition();

  // On `system`, the OS setting can change while the page is open — following
  // it is the whole point of the option, so the change is picked up live.
  useEffect(() => {
    if (theme !== "system") return;
    const media = window.matchMedia(DARK_QUERY);
    const onChange = () => applyTheme("system");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [theme]);

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

        <DropdownMenuItem asChild>
          <Link href="/events">
            <Settings />
            Open orchestrator
          </Link>
        </DropdownMenuItem>

        {canSeeAllEvents(role) && (
          <DropdownMenuCheckboxItem
            checked={scope === "all"}
            onCheckedChange={chooseScope}
            // Keeps the menu open, so the calendar visibly swaps underneath it
            // and a mis-toggle can be undone without reopening.
            onSelect={(e) => e.preventDefault()}
          >
            <CalendarRange />
            All users&rsquo; events
          </DropdownMenuCheckboxItem>
        )}

        {canManageUsers(role) && (
          <DropdownMenuItem asChild>
            <Link href="/users">
              <UsersRound />
              Manage users
            </Link>
          </DropdownMenuItem>
        )}

        <DropdownMenuSeparator />

        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Appearance
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme} onValueChange={choose}>
          {THEME_OPTIONS.map(({ value, label, Icon }) => (
            <DropdownMenuRadioItem key={value} value={value}>
              <Icon />
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>

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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
