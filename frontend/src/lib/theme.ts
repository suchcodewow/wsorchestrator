/** The colour scheme: its cookie, its class, and the first-paint script. */

import type { ThemePreference } from "@/db/schema";

export const DARK_QUERY = "(prefers-color-scheme: dark)";

export const DARK_CLASS = "dark";

export type ResolvedScheme = "dark" | "light";

export const THEME_COOKIE = "theme";

export function isDark(preference: ThemePreference): boolean {
  if (preference === "system") {
    return (
      typeof window !== "undefined" &&
      window.matchMedia(DARK_QUERY).matches
    );
  }
  return preference === "dark";
}

export function parseScheme(value: string | undefined): ResolvedScheme | null {
  return value === "dark" || value === "light" ? value : null;
}

function writeThemeCookie(scheme: ResolvedScheme): void {
  document.cookie = `${THEME_COOKIE}=${scheme}; path=/; max-age=31536000; samesite=lax`;
}

export function applyTheme(preference: ThemePreference): void {
  const dark = isDark(preference);
  const el = document.documentElement;
  el.classList.toggle(DARK_CLASS, dark);
  el.style.colorScheme = dark ? "dark" : "light";
  writeThemeCookie(dark ? "dark" : "light");
}

export function themeScript(
  preference: ThemePreference,
  cookieScheme: ResolvedScheme | null,
): string {
  return `(function(){try{
var p=${JSON.stringify(preference)};
var c=${JSON.stringify(cookieScheme)};
var d=p==="dark"||(p!=="light"&&(c?c==="dark":window.matchMedia(${JSON.stringify(DARK_QUERY)}).matches));
var el=document.documentElement;
el.classList.toggle(${JSON.stringify(DARK_CLASS)},d);
el.style.colorScheme=d?"dark":"light";
}catch(e){}})();`;
}
