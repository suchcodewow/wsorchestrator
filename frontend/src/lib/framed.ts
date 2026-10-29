/**
 * Whether the page is inside a frame on another page, such as a Mindtickle
 * course. A framed page shows only its content, with no header or sidebar and,
 * in a tabbed section, nothing above the tabs, in the light scheme whatever
 * the user's preference; see `themeScript`, which
 * marks `<html>` with `FRAMED_ATTR` before the first paint, and the `framed:`
 * variant in `globals.css`.
 */

export const FRAMED_ATTR = "data-framed";

export function isFramed(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    // A browser that will not even compare the two has a frame to hide.
    return true;
  }
}
