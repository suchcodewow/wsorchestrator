/** A link that starts a page's tour for whoever opens it. */

/** The query parameter a shared tour link carries. */
export const TOUR_PARAM = "tour";

/** This page's address with `?tour` on it, for someone else to open with the tour playing. */
export function tourLink(): string {
  const url = new URL(window.location.href);
  url.searchParams.set(TOUR_PARAM, "1");
  url.hash = "";
  return url.toString();
}
