/**
 * Turning a name somebody typed into an identifier Harness will accept.
 *
 * Pure, and deliberately not `server-only`: the deploy form shows the derived
 * identifier next to the name as it is typed, so the browser needs the same
 * function the server will use. Two implementations of this rule would mean the
 * preview and the org that gets created can disagree.
 *
 * The same rule the runner applies in `runner/src/harness.ts`. Duplicated rather
 * than shared because the runner is a separate service with its own build, and
 * a copy of thirty lines is cheaper than a package between them — but the two
 * are meant to agree, so a change here belongs there too.
 */

/** Harness's own cap on an identifier. */
const MAX_IDENTIFIER = 128;

/**
 * Identifiers Harness reserves for its expression language. Legal syntax, and
 * rejected by the platform — so an organization called "Status" needs a suffix
 * rather than an error nobody can act on.
 */
const RESERVED = new Set([
  "or", "and", "eq", "ne", "lt", "gt", "le", "ge", "div", "mod", "not",
  "null", "true", "false", "new", "var", "return", "step", "parallel",
  "stepgroup", "org", "account", "status", "liteenginetask", "notification",
]);

/**
 * Convert arbitrary text into a legal Harness identifier: disallowed characters
 * collapse to underscores, a leading digit gains an underscore prefix, and a
 * reserved word gains an underscore suffix. Returns null when there is nothing
 * left to work with, which is the one case a caller has to report.
 */
export function harnessIdentifier(input: string): string | null {
  let id = input
    .normalize("NFKD")
    // Drop the combining marks NFKD split off, so "é" becomes "e" not "e_".
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^0-9a-zA-Z_$]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  // Truncated before the two checks below, so neither the leading-digit prefix
  // nor the reserved-word suffix can be trimmed back off afterwards.
  id = id.slice(0, MAX_IDENTIFIER - 1).replace(/_+$/, "");
  if (id.length === 0) return null;

  if (/^[0-9$]/.test(id)) id = `_${id}`;
  if (RESERVED.has(id.toLowerCase())) id = `${id}_`;

  return id;
}
