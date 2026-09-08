/** Turns arbitrary text into a legal Harness identifier. */

const MAX_IDENTIFIER = 128;

const RESERVED = new Set([
  "or", "and", "eq", "ne", "lt", "gt", "le", "ge", "div", "mod", "not",
  "null", "true", "false", "new", "var", "return", "step", "parallel",
  "stepgroup", "org", "account", "status", "liteenginetask", "notification",
]);

export function harnessIdentifier(input: string): string | null {
  let id = input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^0-9a-zA-Z_$]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  id = id.slice(0, MAX_IDENTIFIER - 1).replace(/_+$/, "");
  if (id.length === 0) return null;

  if (/^[0-9$]/.test(id)) id = `_${id}`;
  if (RESERVED.has(id.toLowerCase())) id = `${id}_`;

  return id;
}
