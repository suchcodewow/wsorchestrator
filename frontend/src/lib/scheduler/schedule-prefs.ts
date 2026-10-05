/** Cookies that remember a manager's chosen view and density across every bootcamp's schedule. */

export type ScheduleViewMode = "day" | "week";

export const SCHEDULE_VIEW_COOKIE = "schedule-view";
export const SCHEDULE_CONDENSED_COOKIE = "schedule-condensed";

export function parseScheduleView(value: string | undefined): ScheduleViewMode {
  return value === "week" ? "week" : "day";
}

export function parseScheduleCondensed(value: string | undefined): boolean {
  return value === "1";
}

export function writeScheduleViewCookie(view: ScheduleViewMode): void {
  document.cookie = `${SCHEDULE_VIEW_COOKIE}=${view}; path=/; max-age=31536000; samesite=lax`;
}

export function writeScheduleCondensedCookie(condensed: boolean): void {
  document.cookie = `${SCHEDULE_CONDENSED_COOKIE}=${condensed ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`;
}
