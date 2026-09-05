/**
 * Whether the desktop sidebar is showing labels or collapsed to its icon rail.
 *
 * Kept in a cookie rather than on the user row for the same reason the resolved
 * colour scheme is: the server has to know it *before* it renders, or the
 * sidebar paints at one width and snaps to the other once React hydrates. A
 * cookie is on the request; a database column would need a query the layout
 * would then have to wait for.
 *
 * It is also genuinely per-device — the same account on a laptop and on a wide
 * desktop wants different answers — which is exactly what a cookie already is
 * and what a user row is not.
 */

export const SIDEBAR_COOKIE = "sidebar";

export type SidebarState = "expanded" | "collapsed";

/** Anything that isn't the literal `collapsed` means expanded, including no cookie at all. */
export function parseSidebarState(value: string | undefined): SidebarState {
  return value === "collapsed" ? "collapsed" : "expanded";
}

/** Persist the state so the next server render paints the right width. Client-only. */
export function writeSidebarCookie(state: SidebarState): void {
  // A year, root path, Lax — a view preference, not a secret.
  document.cookie = `${SIDEBAR_COOKIE}=${state}; path=/; max-age=31536000; samesite=lax`;
}
