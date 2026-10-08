/**
 * Test accounts: accounts a platform administrator makes to try the app as
 * someone with a given set of roles, and to change things as them, which
 * viewing as a real employee never allows (`src/lib/impersonation.ts`).
 *
 * They exist only outside production. Production refuses to make one, never
 * finds one to view as, and refuses every change made while viewing as one,
 * so a row that reached production in a restored backup is inert there.
 *
 * Each is an ordinary `users` row with `is_test_account` set, so the Users
 * page sets its roles as it does anyone's. Its address is on a `.invalid`
 * domain, which no Google account can have, so nobody can sign in as one.
 * There is no employee row behind it; the HiBob sync would delete one.
 *
 * Viewing as one, a change is let through unless its route is session-only:
 * those mint tokens, take backups, or change who can sign in, none of which
 * belongs to a test.
 */

import "server-only";

import { randomBytes } from "node:crypto";
import { and, count, eq } from "drizzle-orm";
import { db } from "@/db";
import { TEST_ACCOUNT_LIMITS, users, workshopRuns } from "@/db/schema";
import { noteAudit } from "@/lib/audit-context";
import { isProduction } from "@/lib/deployment";
import { searchAny } from "@/lib/paging-sql";
import { canImpersonate, type Access } from "@/lib/roles";

/** Reserved by RFC 2606: no mailbox, and no Google account, can be on it. */
export const TEST_ACCOUNT_DOMAIN = "test-account.invalid";

/** How many the impersonation picker shows for a search. */
const SEARCH_LIMIT = 8;

export function testAccountsAllowed(): boolean {
  return !isProduction();
}

/**
 * Whether a change may go through while viewing the app as a test account:
 * outside production, on a route a token could also call. A route missing
 * from the catalog is refused; the unit suite keeps every route in it.
 */
export function testAccountMayChange(endpoint: { token: boolean } | null | undefined): boolean {
  return testAccountsAllowed() && endpoint?.token === true;
}

/** `Iris tester` → `iris-tester-3fa9c1@test-account.invalid`; the suffix keeps two of a name apart. */
export function testAccountEmail(name: string, suffix = randomBytes(3).toString("hex")): string {
  const slug = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${slug || "test"}-${suffix}@${TEST_ACCOUNT_DOMAIN}`;
}

export type TestAccount = { id: string; name: string | null; email: string };

/**
 * - `production` — this deployment is production.
 * - `forbidden`  — only a platform administrator, who alone can view as one, makes them.
 * - `invalid`    — the name is blank or too long.
 */
export type CreateTestAccountError = "production" | "forbidden" | "invalid";

/** A new test account with no roles; the Users page grants them. */
export async function createTestAccount(
  actor: { access: Access },
  name: string,
): Promise<{ ok: true; account: TestAccount } | { ok: false; error: CreateTestAccountError }> {
  if (!testAccountsAllowed()) return { ok: false, error: "production" };
  if (!canImpersonate(actor.access)) return { ok: false, error: "forbidden" };
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > TEST_ACCOUNT_LIMITS.name) return { ok: false, error: "invalid" };

  const [account] = await db
    .insert(users)
    .values({ name: trimmed, email: testAccountEmail(trimmed), isTestAccount: true })
    .returning({ id: users.id, name: users.name, email: users.email });
  noteAudit({ target: account!.id, targetLabel: account!.email! });
  return { ok: true, account: { ...account!, email: account!.email! } };
}

/**
 * - `production`  — this deployment is production.
 * - `forbidden`   — only a platform administrator resets them.
 * - `not_found`   — no test account has that id; a real account is never reset.
 * - `owns_events` — an event keeps its owner, and is torn down through the event.
 */
export type ResetTestAccountError = "production" | "forbidden" | "not_found" | "owns_events";

/**
 * Gives a test account a fresh start: everything that is its own goes, as if
 * it had been deleted, and it comes straight back with the same id, name,
 * address and roles. Its Iris sittings and track go with it, so it can take
 * the same test again. What it authored elsewhere stays, unattributed, as it
 * does when any account is deleted.
 */
export async function resetTestAccount(
  actor: { access: Access },
  id: string,
): Promise<{ ok: true } | { ok: false; error: ResetTestAccountError }> {
  if (!testAccountsAllowed()) return { ok: false, error: "production" };
  if (!canImpersonate(actor.access)) return { ok: false, error: "forbidden" };

  const [{ events }] = await db.select({ events: count() }).from(workshopRuns).where(eq(workshopRuns.userId, id));
  if (events > 0) return { ok: false, error: "owns_events" };

  try {
    const reset = await db.transaction(async (tx) => {
      const [row] = await tx
        .delete(users)
        .where(and(eq(users.id, id), eq(users.isTestAccount, true)))
        .returning();
      if (!row) return null;
      await tx.insert(users).values(row);
      return row;
    });
    if (!reset) return { ok: false, error: "not_found" };
    noteAudit({ targetLabel: reset.email ?? undefined });
  } catch (err) {
    // An event made since the count above still holds its owner.
    const e = err as { code?: string; cause?: { code?: string } } | null;
    if ((e?.code ?? e?.cause?.code) === "23503") return { ok: false, error: "owns_events" };
    throw err;
  }
  return { ok: true };
}

/** The first few test accounts matching `q` by name or address; none on production. */
export async function searchTestAccounts(q: string): Promise<TestAccount[]> {
  if (!testAccountsAllowed()) return [];
  const rows = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(and(eq(users.isTestAccount, true), searchAny(q.trim(), [users.name, users.email])))
    .orderBy(users.name, users.id)
    .limit(SEARCH_LIMIT);
  return rows.map((r) => ({ ...r, email: r.email ?? "" }));
}
