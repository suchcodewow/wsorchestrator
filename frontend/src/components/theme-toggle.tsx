"use client";

import { useState, useTransition } from "react";
import { Laptop, Moon, Sun, type LucideIcon } from "lucide-react";
import { THEME_PREFERENCES, type ThemePreference } from "@/db/schema";
import { applyTheme } from "@/lib/theme";
import { setThemePreference } from "@/lib/user-settings";
import { cn } from "@/lib/utils";

export const THEME_OPTIONS: {
  value: ThemePreference;
  label: string;
  Icon: LucideIcon;
}[] = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System default", Icon: Laptop },
];

/**
 * The state and the write behind the appearance control, shared by the two
 * places that draw one: the sidebar footer and the dropdown under the username.
 *
 * Live OS-change following for `system` is not here — it lives in ThemeSync in
 * the root layout, so it works on every page rather than only where a control
 * happens to be mounted.
 */
export function useThemeChoice(initial: ThemePreference) {
  const [theme, setTheme] = useState<ThemePreference>(initial);
  const [, startTransition] = useTransition();

  function choose(value: string) {
    // Radix hands back a plain string; narrow it before it goes any further.
    if (!THEME_PREFERENCES.includes(value as ThemePreference)) return;
    const preference = value as ThemePreference;

    setTheme(preference);
    // Repaint immediately rather than waiting on the round trip — the write is
    // only about surviving a reload, and the control should never feel laggy.
    applyTheme(preference);
    startTransition(() => {
      void setThemePreference(preference);
    });
  }

  return { theme, choose };
}

/**
 * The appearance control as a standalone segmented row, for the sidebar footer.
 *
 * The dropdown under the username cannot use this: inside a Radix menu the
 * options have to be real `menuitemradio`s or the menu's arrow keys skip them,
 * which is what `DropdownMenuRadioIconItem` is for. Here there is no menu to
 * belong to, so plain buttons in a `radiogroup` are both simpler and correct.
 *
 * `aria-label` on each: with the text gone, nothing else names the option.
 */
export function ThemeToggle({
  value,
  onChange,
  className,
}: {
  value: ThemePreference;
  onChange: (value: ThemePreference) => void;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Appearance"
      className={cn("flex items-center gap-0.5 rounded-lg bg-muted p-0.5", className)}
    >
      {THEME_OPTIONS.map(({ value: option, label, Icon }) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={value === option}
          aria-label={label}
          title={label}
          onClick={() => onChange(option)}
          className={cn(
            "flex size-6.5 cursor-pointer items-center justify-center rounded-md outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50",
            // Filled rather than ticked: in a row of three, "which is lit" is
            // legible at a glance in a way a tick beside a glyph is not.
            value === option
              ? "bg-background text-foreground shadow-xs"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Icon className="size-4" />
        </button>
      ))}
    </div>
  );
}
