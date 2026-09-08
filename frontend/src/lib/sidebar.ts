/** The cookie that remembers whether the sidebar is collapsed. */

export const SIDEBAR_COOKIE = "sidebar";

export type SidebarState = "expanded" | "collapsed";

export function parseSidebarState(value: string | undefined): SidebarState {
  return value === "collapsed" ? "collapsed" : "expanded";
}

export function writeSidebarCookie(state: SidebarState): void {
  document.cookie = `${SIDEBAR_COOKIE}=${state}; path=/; max-age=31536000; samesite=lax`;
}
