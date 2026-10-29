/**
 * The sites allowed to show the app in a frame, as the `frame-ancestors` of
 * the Content-Security-Policy the proxy sends with every page. Pure, so the
 * settings page can check what is typed; the list itself is read by
 * `src/lib/frame-domains.ts`.
 */

import { normalizeDomain } from "@/lib/email-domains";

/** A domain from a bare domain, `*.domain`, or a URL on it; null if it is none of those. */
export function normalizeFrameDomain(value: string): string | null {
  let host = value.trim().toLowerCase();
  if (host.includes("://")) {
    try {
      host = new URL(host).hostname;
    } catch {
      return null;
    }
  }
  host = host.replace(/^\*\./, "").split(/[/:?#]/)[0]!;
  if (host.includes("@")) return null;
  return normalizeDomain(host);
}

/**
 * The directive for these domains: each one and its subdomains, after the
 * app's own pages. A source without a scheme matches the page's own scheme
 * and its upgrade to https, so the same policy serves http on a laptop.
 */
export function frameAncestors(domains: string[]): string {
  return ["frame-ancestors", "'self'", ...domains.flatMap((d) => [d, `*.${d}`])].join(" ");
}
