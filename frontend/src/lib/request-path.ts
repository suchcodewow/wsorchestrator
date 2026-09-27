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
  // A browser drops tabs and newlines from a URL and reads `\` as `/`, so
  // `/\t/evil.example` lands on another site. Judge by where the value lands.
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value, RESOLVE_AGAINST);
  } catch {
    return null;
  }
  if (url.origin !== RESOLVE_AGAINST) return null;
  if (url.pathname === "/signin") return null;
  return value;
}

const RESOLVE_AGAINST = "http://return-path.invalid";
