import type { ThemePreference } from "@/db/schema";

export const DARK_QUERY = "(prefers-color-scheme: dark)";

/** The class `globals.css` hangs its dark token overrides off. */
export const DARK_CLASS = "dark";

/** The concretely resolved scheme — never `system`, always a real colour. */
export type ResolvedScheme = "dark" | "light";

/**
 * Cookie holding the last *resolved* scheme (never `system`).
 *
 * The point of the cookie: `system` can only be resolved with the browser, so
 * without it the server has nothing to render and the first paint is left to a
 * client `matchMedia` read — a single synchronous read on the first script tick
 * that can come back light before the browser has settled `prefers-color-scheme`,
 * and then sticks for the whole page. Caching the resolved value here lets both
 * the server and the inlined script paint a deterministic scheme, and pushes
 * `matchMedia` to after paint (where it is reliable) via [[ThemeSync]].
 *
 * Not `httpOnly`: the inlined head script has to read it before React exists.
 */
export const THEME_COOKIE = "theme";

/**
 * Resolve a preference to whether the document should be dark right now.
 * `system` needs the browser, so this is only meaningful client-side.
 */
export function isDark(preference: ThemePreference): boolean {
  if (preference === "system") {
    return (
      typeof window !== "undefined" &&
      window.matchMedia(DARK_QUERY).matches
    );
  }
  return preference === "dark";
}

/** Narrow a raw cookie value to a resolved scheme, or null if it isn't one. */
export function parseScheme(value: string | undefined): ResolvedScheme | null {
  return value === "dark" || value === "light" ? value : null;
}

/** Persist the resolved scheme so the next load can paint it server-side. */
function writeThemeCookie(scheme: ResolvedScheme): void {
  // A year, root path, Lax — a view preference, not a secret.
  document.cookie = `${THEME_COOKIE}=${scheme}; path=/; max-age=31536000; samesite=lax`;
}

/**
 * Paint `preference` onto <html>: the dark class, the native `color-scheme`
 * (so form controls and scrollbars match), and the cookie that lets the next
 * server render skip the client round-trip. Client-only.
 */
export function applyTheme(preference: ThemePreference): void {
  const dark = isDark(preference);
  const el = document.documentElement;
  el.classList.toggle(DARK_CLASS, dark);
  el.style.colorScheme = dark ? "dark" : "light";
  writeThemeCookie(dark ? "dark" : "light");
}

/**
 * A self-contained script inlined into <head>, before any markup renders, so
 * the correct theme is painted on the very first frame instead of flashing
 * light and correcting itself.
 *
 * The user's stored preference is baked in as a literal by the server. For an
 * explicit `light`/`dark` that alone settles it. For `system` it reads the
 * cached cookie scheme — also baked in — rather than `matchMedia`, so the paint
 * is deterministic and matches the class the server rendered onto <html>. Only
 * a first-ever visit (no cookie yet) falls back to a one-time `matchMedia` read;
 * [[ThemeSync]] then writes the cookie for every load after.
 *
 * Written as a plain string because it must run before React hydrates — and
 * wrapped in try/catch because a theme is never worth breaking a page over.
 */
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
