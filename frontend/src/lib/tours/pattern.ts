/**
 * Which pages a tour belongs to. A tour is written against a path pattern, not
 * a URL, so one tour serves every event's page: `/events/[id]` matches
 * `/events/3f2c…` and `/events/9a1b…` alike, where a `[name]` segment stands
 * for any one segment and every other segment must match as written.
 *
 * The database stores the pattern and the regex made from it, so finding a
 * page's tour is one indexed query; when two patterns match, the one with
 * more written-out segments wins (`/events/new` over `/events/[id]`).
 *
 * Pure, so the header, the routes and the unit suite share it.
 */

export const MAX_PATTERN_LENGTH = 300;

const LITERAL = /^[A-Za-z0-9._~-]+$/;
const PARAM = /^\[[A-Za-z][A-Za-z0-9_]*\]$/;

/** The segments of a valid pattern, or null: a leading slash, then literal or `[name]` segments, none empty. */
function segmentsOf(pattern: string): string[] | null {
  if (pattern.length > MAX_PATTERN_LENGTH || !pattern.startsWith("/")) return null;
  if (pattern === "/") return [];
  const segments = pattern.slice(1).split("/");
  return segments.every((s) => LITERAL.test(s) || PARAM.test(s)) ? segments : null;
}

export function isTourPattern(pattern: string): boolean {
  return segmentsOf(pattern) !== null;
}

/** The Postgres (and JavaScript) regex a valid pattern stands for, anchored at both ends. */
export function patternRegex(pattern: string): string {
  const segments = segmentsOf(pattern);
  if (!segments) throw new Error(`not a tour pattern: ${pattern}`);
  if (segments.length === 0) return "^/$";
  const parts = segments.map((s) => (PARAM.test(s) ? "[^/]+" : s.replaceAll(".", "\\.")));
  return `^/${parts.join("/")}$`;
}

/** How many segments are written out; the more, the more specific. */
export function patternSpecificity(pattern: string): number {
  return (segmentsOf(pattern) ?? []).filter((s) => !PARAM.test(s)).length;
}

/** A segment that is some record's id rather than a page's name: a UUID, a number, or a long run of letters and digits with at least one digit. */
function looksLikeId(segment: string): boolean {
  return (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment) ||
    /^\d+$/.test(segment) ||
    (segment.length >= 16 && /^[A-Za-z0-9_-]+$/.test(segment) && /\d/.test(segment))
  );
}

/** The pattern the editor offers for the page at `pathname`: each id-like segment becomes `[id]`. */
export function suggestPattern(pathname: string): string {
  const segments = pathname.split("/").filter(Boolean);
  const pattern = `/${segments.map((s) => (looksLikeId(s) ? "[id]" : s)).join("/")}`;
  return isTourPattern(pattern) ? pattern : "/";
}

/** The path a request is for, cleaned: no query, no trailing slash. */
export function normalizePath(path: string): string {
  const bare = path.split(/[?#]/)[0] ?? "/";
  return bare.length > 1 ? bare.replace(/\/+$/, "") || "/" : "/";
}
