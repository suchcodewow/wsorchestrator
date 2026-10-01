/**
 * How a request becomes an audit row, without the I/O: which API reference
 * entry it was, what of its body is fit to keep, what it created, and whether
 * it worked. Kept apart from `audit.ts` so the unit suite can load it.
 */

import { GROUPS, type Endpoint } from "@/lib/api-reference";
import type { AuditOutcome } from "@/db/schema";

type Matcher = { endpoint: Endpoint; pattern: RegExp; literal: number };

let matchers: Matcher[] | null = null;

/** The API reference entry a request is for, matching `/api/runs/{id}` against `/api/runs/abc`. */
export function endpointFor(method: string, pathname: string): Endpoint | null {
  matchers ??= GROUPS.flatMap((g) => g.endpoints)
    .map((endpoint) => {
      const segments = endpoint.path.split("/");
      const pattern = segments
        .map((s) =>
          /^\{\.\.\..+\}$/.test(s)
            ? ".+"
            : /^\{.+\}$/.test(s)
              ? "[^/]+"
              : s.replace(/[.*+?^$()|[\]\\]/g, "\\$&"),
        )
        .join("/");
      return {
        endpoint,
        pattern: new RegExp(`^${pattern}/?$`),
        literal: segments.filter((s) => !s.startsWith("{")).length,
      };
    })
    // `/api/runs/calendar` before `/api/runs/{id}`.
    .sort((a, b) => b.literal - a.literal);

  const path = pathname.replace(/\/+$/, "") || "/";
  return (
    matchers.find((m) => m.endpoint.method === method && m.pattern.test(path))
      ?.endpoint ?? null
  );
}

/** Keys whose string values are secrets, or close enough not to keep. */
const SECRET_KEY = /token|secret|password|passphrase|credential|api_?key|private|^value$/i;
const MAX_STRING = 300;
const MAX_ITEMS = 25;
const MAX_DEPTH = 4;

/**
 * A request body fit to keep: secret-looking keys blanked, long strings and
 * lists cut short, deep nesting elided. Booleans and numbers under a
 * secret-looking key are kept — `{ area: "platform", value: true }` says
 * nothing secret.
 */
export function redact(value: unknown, key?: string, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "boolean" || typeof value === "number") return value;
  if (key && SECRET_KEY.test(key)) return "[redacted]";
  if (typeof value === "string") {
    return value.length > MAX_STRING
      ? `${value.slice(0, MAX_STRING)}… (${value.length} characters)`
      : value;
  }
  if (depth >= MAX_DEPTH) return "[…]";
  if (Array.isArray(value)) {
    const kept = value.slice(0, MAX_ITEMS).map((v) => redact(v, key, depth + 1));
    return value.length > MAX_ITEMS
      ? [...kept, `… and ${value.length - MAX_ITEMS} more`]
      : kept;
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        redact(v, k, depth + 1),
      ]),
    );
  }
  return String(value);
}

const LABEL_KEYS = ["name", "title", "email", "domain", "identifier"] as const;

function labelOf(obj: Record<string, unknown>): string | undefined {
  for (const k of LABEL_KEYS) {
    if (typeof obj[k] === "string" && obj[k]) return obj[k] as string;
  }
  return undefined;
}

/**
 * What a successful creation made, from its response: a top-level `id`, or
 * the `id` of the first object in it — `{ run: { id, name } }`.
 */
export function createdTarget(
  body: Record<string, unknown>,
): { target?: string; targetLabel?: string } {
  if (typeof body.id === "string" || typeof body.id === "number") {
    return { target: String(body.id), targetLabel: labelOf(body) };
  }
  for (const v of Object.values(body)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const obj = v as Record<string, unknown>;
      if (typeof obj.id === "string" || typeof obj.id === "number") {
        return { target: String(obj.id), targetLabel: labelOf(obj) };
      }
    }
  }
  return {};
}

export function outcomeFor(status: number): AuditOutcome {
  if (status < 400) return "succeeded";
  if (status === 403) return "denied";
  return "failed";
}
