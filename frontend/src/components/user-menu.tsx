"use client";

import { useEffect, useState, useTransition } from "react";
import { ChevronDown, Laptop, Moon, Sun } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { THEME_PREFERENCES, type ThemePreference } from "@/db/schema";
import { setThemePreference } from "@/lib/user-settings";
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
  initialTheme,
}: {
  name: string | null;
  email: string;
  initialTheme: ThemePreference;
}) {
  const [theme, setTheme] = useState<ThemePreference>(initialTheme);
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
        </DropdownMenuLabel>

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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
