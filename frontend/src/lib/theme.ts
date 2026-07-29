import type { ThemePreference } from "@/db/schema";

export const DARK_QUERY = "(prefers-color-scheme: dark)";

/** The class `globals.css` hangs its dark token overrides off. */
export const DARK_CLASS = "dark";

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

/** Add or remove the dark class on <html> to match `preference`. */
export function applyTheme(preference: ThemePreference): void {
  document.documentElement.classList.toggle(DARK_CLASS, isDark(preference));
}

/**
 * A self-contained script inlined into <head>, before any markup renders, so
 * the correct theme is painted on the very first frame instead of flashing
 * light and correcting itself.
 *
 * The user's stored preference is baked in as a literal by the server, so this
 * needs neither a network call nor storage to read. It only has real work to
 * do for `system`, which no server can resolve.
 *
 * Written as a plain string because it must run before React hydrates — and
 * wrapped in try/catch because a theme is never worth breaking a page over.
 */
export function themeScript(preference: ThemePreference): string {
  return `(function(){try{
var p=${JSON.stringify(preference)};
var d=p==="dark"||(p==="system"&&window.matchMedia(${JSON.stringify(DARK_QUERY)}).matches);
document.documentElement.classList.toggle(${JSON.stringify(DARK_CLASS)},d);
}catch(e){}})();`;
}
