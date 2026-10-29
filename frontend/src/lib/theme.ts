/** The colour scheme: its cookie, its class, and the first-paint script. */

import type { ThemePreference } from "@/db/schema";
import { FRAMED_ATTR, isFramed } from "@/lib/framed";

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

/**
 * Paints the preference, and remembers the scheme for the server's next paint.
 * A framed page is always light and remembers nothing, so the light it is
 * forced into never reaches the user's own tabs.
 */
export function applyTheme(preference: ThemePreference): void {
  const framed = isFramed();
  const dark = !framed && isDark(preference);
  const el = document.documentElement;
  el.classList.toggle(DARK_CLASS, dark);
  el.style.colorScheme = dark ? "dark" : "light";
  if (!framed) writeThemeCookie(dark ? "dark" : "light");
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
var f;try{f=window.self!==window.top}catch(e){f=true}
if(f){el.setAttribute(${JSON.stringify(FRAMED_ATTR)},"");d=false;}
el.classList.toggle(${JSON.stringify(DARK_CLASS)},d);
el.style.colorScheme=d?"dark":"light";
}catch(e){}})();`;
}
