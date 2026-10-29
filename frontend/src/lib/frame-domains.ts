/**
 * The sites allowed to show the app in a frame, as an administrator edits them
 * on the Allowed Domains tab, and the `frame-ancestors` policy built from them
 * (`src/lib/frame-ancestors.ts`). Only these sites, and the app itself, may
 * frame it.
 */

import "server-only";

import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { allowedFrameDomains, users } from "@/db/schema";
import type { Actor } from "@/lib/allowed-domains";
import { frameAncestors, normalizeFrameDomain } from "@/lib/frame-ancestors";
import type { FrameDomainSort } from "@/lib/list-specs";
import { pageWindow, toPage, type ListQuery, type Page } from "@/lib/paging";
import { blankAsNull, orderFor, searchAny } from "@/lib/paging-sql";

export type FrameDomainRow = {
  id: string;
  domain: string;
  note: string;
  createdAt: Date;
  addedBy: string | null;
};

const SORT_COLUMNS = {
  domain: allowedFrameDomains.domain,
  note: sql`lower(${blankAsNull(allowedFrameDomains.note)})`,
  addedBy: sql`lower(coalesce(nullif(${users.name}, ''), ${users.email}))`,
} as const;

/** One page of the frame domains; the search matches the domain, the note or who added it. */
export async function listFrameDomains(query: ListQuery<FrameDomainSort>): Promise<Page<FrameDomainRow>> {
  const { limit, offset } = pageWindow(query.page);
  const rows = await db
    .select({
      id: allowedFrameDomains.id,
      domain: allowedFrameDomains.domain,
      note: allowedFrameDomains.note,
      createdAt: allowedFrameDomains.createdAt,
      addedByName: users.name,
      addedByEmail: users.email,
    })
    .from(allowedFrameDomains)
    .leftJoin(users, eq(users.id, allowedFrameDomains.createdBy))
    .where(searchAny(query.q, [allowedFrameDomains.domain, allowedFrameDomains.note, users.name, users.email]))
    .orderBy(...orderFor(SORT_COLUMNS[query.sort], query.dir, allowedFrameDomains.domain))
    .limit(limit)
    .offset(offset);

  return toPage(
    rows.map(({ addedByName, addedByEmail, ...row }) => ({
      ...row,
      addedBy: addedByName ?? addedByEmail,
    })),
    query.page,
  );
}

export type FrameDomainError = "invalid" | "duplicate" | "not_found";

type Result = { ok: true } | { ok: false; error: FrameDomainError };

export const FRAME_STATUS_FOR: Record<FrameDomainError, number> = {
  invalid: 400,
  duplicate: 409,
  not_found: 404,
};

async function currentDomains(): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: allowedFrameDomains.id, domain: allowedFrameDomains.domain })
    .from(allowedFrameDomains);
  return new Map(rows.map((r) => [r.id, r.domain]));
}

export async function addFrameDomain(
  actor: Actor,
  input: { domain: string; note?: string },
): Promise<Result & { domain?: string }> {
  const domain = normalizeFrameDomain(input.domain);
  if (!domain) return { ok: false, error: "invalid" };

  const current = await currentDomains();
  if ([...current.values()].includes(domain)) return { ok: false, error: "duplicate" };

  await db.insert(allowedFrameDomains).values({
    domain,
    note: input.note?.trim() ?? "",
    createdBy: actor.id,
  });
  forgetPolicy();
  return { ok: true, domain };
}

export async function updateFrameDomain(
  id: string,
  input: { domain: string; note?: string },
): Promise<Result & { domain?: string }> {
  const domain = normalizeFrameDomain(input.domain);
  if (!domain) return { ok: false, error: "invalid" };

  const current = await currentDomains();
  if (!current.has(id)) return { ok: false, error: "not_found" };
  for (const [otherId, otherDomain] of current) {
    if (otherId !== id && otherDomain === domain) return { ok: false, error: "duplicate" };
  }

  await db
    .update(allowedFrameDomains)
    .set({ domain, note: input.note?.trim() ?? "" })
    .where(eq(allowedFrameDomains.id, id));
  forgetPolicy();
  return { ok: true, domain };
}

export async function deleteFrameDomain(id: string): Promise<Result & { domain?: string }> {
  const [row] = await db
    .delete(allowedFrameDomains)
    .where(eq(allowedFrameDomains.id, id))
    .returning({ domain: allowedFrameDomains.domain });
  if (!row) return { ok: false, error: "not_found" };
  forgetPolicy();
  return { ok: true, domain: row.domain };
}

/**
 * How long an instance keeps the policy before reading the table again. A
 * change made on one instance reaches the others within this.
 */
const POLICY_TTL_MS = 30_000;

// On globalThis so the proxy and the route handlers, bundled apart, share it.
const store = globalThis as unknown as { frameAncestorsPolicy?: { policy: string; at: number } };

function forgetPolicy() {
  delete store.frameAncestorsPolicy;
}

/** The `frame-ancestors` directive the proxy sends, read at most every `POLICY_TTL_MS`. */
export async function frameAncestorsPolicy(): Promise<string> {
  const cached = store.frameAncestorsPolicy;
  if (cached && Date.now() - cached.at < POLICY_TTL_MS) return cached.policy;

  let policy: string;
  try {
    const rows = await db.select({ domain: allowedFrameDomains.domain }).from(allowedFrameDomains);
    policy = frameAncestors(rows.map((r) => r.domain));
  } catch {
    // Keep what was last read; with nothing read yet, only the app frames itself.
    policy = cached?.policy ?? frameAncestors([]);
  }
  store.frameAncestorsPolicy = { policy, at: Date.now() };
  return policy;
}
