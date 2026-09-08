"use client";

/** The account menu, everywhere one is opened. */

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

const SECTION_HEADING =
  "px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground";

const THEME_OPTIONS: { value: ThemePreference; label: string; Icon: LucideIcon }[] = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System default", Icon: Laptop },
];

export type MenuVariant = "header" | "sidebar" | "rail";

const TRIGGER_CLASS: Record<MenuVariant, string> = {
  header:
    "flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-sm text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50",
  sidebar:
    "flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50",
  rail: "flex size-10 cursor-pointer items-center justify-center rounded-lg outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50",
};

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
  build: BuildInfo;
  signOutAction: () => Promise<void>;
  accountOnly?: boolean;
  variant?: MenuVariant;
}) {
  const router = useRouter();
  const [theme, setTheme] = useState<ThemePreference>(initialTheme);
  const [scope, setScope] = useState<CalendarScope>(initialScope);
  const [, startTransition] = useTransition();

  function chooseTheme(value: string) {
    if (!THEME_PREFERENCES.includes(value as ThemePreference)) return;
    const preference = value as ThemePreference;

    setTheme(preference);
    applyTheme(preference);
    startTransition(() => {
      void setThemePreference(preference);
    });
  }

  function chooseScope(all: boolean) {
    const next: CalendarScope = all ? "all" : "own";
    setScope(next);
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
        aria-label={variant === "rail" ? (name ?? email) : undefined}
        className={TRIGGER_CLASS[variant]}
      >
        {variant === "header" && (
          <>
            <span className="max-w-28 truncate sm:max-w-48">{name ?? email}</span>
            <ChevronDown className="size-4 shrink-0" />
          </>
        )}

        {variant === "rail" && <Avatar name={name} email={email} />}

        {variant === "sidebar" && (
          <>
            <Avatar name={name} email={email} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{name ?? email}</span>
              {name && (
                <span className="block truncate text-xs text-muted-foreground">{email}</span>
              )}
            </span>
            <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
          </>
        )}
      </DropdownMenuTrigger>

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
          {elevated && (
            <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-medium text-brand">
              <ShieldCheck className="size-3" />
              {SITE_ROLE_LABELS[role]}
            </span>
          )}
        </DropdownMenuLabel>

        {sections.map((section) => (
          <Fragment key={section.heading ?? "main"}>
            <DropdownMenuSeparator />
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
                onSelect={(e) => e.preventDefault()}
              >
                <CalendarRange />
                Show all events
              </DropdownMenuSwitchItem>
            )}
          </Fragment>
        ))}

        <DropdownMenuSeparator />

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

        <DropdownMenuItem onSelect={() => startTransition(() => void signOutAction())}>
          <LogOut />
          Sign out
        </DropdownMenuItem>

        <DropdownMenuSeparator />

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
