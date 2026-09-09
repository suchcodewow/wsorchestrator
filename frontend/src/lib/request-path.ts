/**
 * The path a request asked for, carried from the proxy into the render so a
 * sign-in redirect can send the visitor back where they were headed.
 */

/** Set by the proxy on every request: the requested path and query. */
export const REQUEST_PATH_HEADER = "x-request-path";

/**
 * The same-site path to return to after signing in, or null when the value is
 * missing, points off-site, or would loop back to sign-in.
 */
export function returnPath(value: string | null | undefined): string | null {
  if (!value || !value.startsWith("/")) return null;
  if (value.startsWith("//") || value.startsWith("/\\")) return null;
  if (value === "/signin" || value.startsWith("/signin?")) return null;
  return value;
}
