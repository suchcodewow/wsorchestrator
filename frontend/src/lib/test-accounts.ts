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
import { and, count, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { TEST_ACCOUNT_LIMITS, employees, irisTakers, users, workshopRuns } from "@/db/schema";
import { noteAudit } from "@/lib/audit-context";
import { isProduction } from "@/lib/deployment";
import { searchAny } from "@/lib/paging-sql";
import { canImpersonate, type Access } from "@/lib/roles";
import { isBootstrapAdmin } from "@/lib/site-admins";
import { CHARACTER_NAMES, pickCharacterName } from "@/lib/test-account-names";

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
 * - `production`      — this deployment is production.
 * - `forbidden`       — only a platform administrator, who alone can view as one, makes them.
 * - `invalid`         — the name is blank or too long.
 * - `source_not_found` — neither an employee nor an account has the address to copy from.
 * - `platform_source` — the account to copy from is a platform administrator,
 *                       which a test account never is: viewing as one would
 *                       show nothing an administrator does not already see.
 */
export type CreateTestAccountError = "production" | "forbidden" | "invalid" | "source_not_found" | "platform_source";

/**
 * A new test account. With `copyFrom`, an address, it starts as a copy of the
 * account with that address, once: its roles in each area, its theme and
 * calendar settings, and its Iris track. Nothing else comes over: not their
 * Iris sittings or Mimir progress, not their Harness credentials, and not
 * being a manager or a guest judge, which follow from a person's own address.
 * An employee who has never signed in has no account to copy, so it starts as
 * they would: with no roles. Without `copyFrom`, the same, and the Users page
 * grants them.
 */
export async function createTestAccount(
  actor: { access: Access },
  name: string,
  copyFrom?: string,
): Promise<{ ok: true; account: TestAccount } | { ok: false; error: CreateTestAccountError }> {
  if (!testAccountsAllowed()) return { ok: false, error: "production" };
  if (!canImpersonate(actor.access)) return { ok: false, error: "forbidden" };
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > TEST_ACCOUNT_LIMITS.name) return { ok: false, error: "invalid" };

  let copied: Partial<typeof users.$inferInsert> = {};
  let track: string | null = null;
  const address = copyFrom?.trim().toLowerCase();
  if (address) {
    if (isBootstrapAdmin(address)) return { ok: false, error: "platform_source" };
    const [source] = await db
      .select({
        eventRole: users.eventRole,
        trainingRole: users.trainingRole,
        assessmentsRole: users.assessmentsRole,
        themePreference: users.themePreference,
        calendarScope: users.calendarScope,
        isPlatformAdmin: users.isPlatformAdmin,
        track: irisTakers.track,
      })
      .from(users)
      .leftJoin(irisTakers, eq(irisTakers.userId, users.id))
      .where(sql`lower(${users.email}) = ${address}`);
    if (source) {
      if (source.isPlatformAdmin) return { ok: false, error: "platform_source" };
      copied = {
        eventRole: source.eventRole,
        trainingRole: source.trainingRole,
        assessmentsRole: source.assessmentsRole,
        themePreference: source.themePreference,
        calendarScope: source.calendarScope,
      };
      track = source.track;
    } else {
      const [employee] = await db.select({ id: employees.id }).from(employees).where(eq(employees.email, address));
      if (!employee) return { ok: false, error: "source_not_found" };
    }
  }

  const account = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(users)
      .values({ ...copied, name: trimmed, email: testAccountEmail(trimmed), isTestAccount: true })
      .returning({ id: users.id, name: users.name, email: users.email });
    if (track) await tx.insert(irisTakers).values({ userId: row!.id, track });
    return row!;
  });
  noteAudit({
    target: account.id,
    targetLabel: account.email!,
    ...(address && { detail: { copiedFrom: address } }),
  });
  return { ok: true, account: { ...account, email: account.email! } };
}

/**
 * A character's name (`src/lib/test-account-names.ts`) that no account has
 * yet, for a new test account to start with, and not `skip`, the one the
 * dialog already shows when asked for another; null when every one is taken,
 * and on production, which makes none.
 */
export async function suggestTestAccountName(skip?: string): Promise<string | null> {
  if (!testAccountsAllowed()) return null;
  const lowered = sql<string>`lower(${users.name})`;
  const taken = await db
    .selectDistinct({ name: lowered })
    .from(users)
    .where(
      inArray(
        lowered,
        CHARACTER_NAMES.map((n) => n.toLowerCase()),
      ),
    )
    .limit(CHARACTER_NAMES.length);
  return pickCharacterName([...taken.map((r) => r.name), ...(skip ? [skip] : [])]);
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
