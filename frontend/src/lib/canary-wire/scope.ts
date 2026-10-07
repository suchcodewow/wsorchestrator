/**
 * Whose Canary Wire a caller sees. A manager opens on their own org — them
 * and everyone under them — and may switch to everyone; anyone else who can
 * see the page (a platform administrator) sees everyone. The page and the API
 * both decide here, from `?scope=`, so a token can't see more than the page.
 */

import type { Access } from "@/lib/roles";

/**
 * Whose Canary Wire: `everyone`, or `org`, the manager `email` and everyone
 * under them.
 */
export type CanaryWireScope = { kind: "everyone" } | { kind: "org"; email: string };

export const SCOPES = ["org", "everyone"] as const;
export type ScopeName = (typeof SCOPES)[number];

export type ScopeError = "invalid_scope" | "not_a_manager";

export function scopeFor(
  caller: { access: Access; email: string | null },
  asked: string | null | undefined,
): { ok: true; scope: CanaryWireScope } | { ok: false; error: ScopeError } {
  if (asked && !SCOPES.includes(asked as ScopeName)) return { ok: false, error: "invalid_scope" };
  const name = (asked as ScopeName | undefined) ?? (caller.access.manager ? "org" : "everyone");
  if (name === "everyone") return { ok: true, scope: { kind: "everyone" } };
  if (!caller.access.manager || !caller.email) return { ok: false, error: "not_a_manager" };
  return { ok: true, scope: { kind: "org", email: caller.email } };
}
