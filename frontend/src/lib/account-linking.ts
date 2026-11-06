/**
 * Which Google sign-ins may link to an account found by address.
 *
 * Google sign-in links by address (`allowDangerousEmailAccountLinking` in
 * src/auth.ts) so that someone a platform administrator added before their
 * first sign-in (`addUser` in src/lib/site-users.ts) lands on that account.
 * Only such an account, with no Google account linked yet, may be linked.
 * One already linked to a different Google account means the address has
 * passed to someone new, a deleted Workspace account's address reissued, say,
 * and they must not inherit the old account's roles.
 */

import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { accounts, users } from "@/db/schema";

/** Whether a sign-in as Google account `providerAccountId` with `email` would take over someone else's account. */
export async function isAddressReused(email: string | null | undefined, providerAccountId: string): Promise<boolean> {
  const address = email?.trim().toLowerCase();
  if (!address) return false;

  const linked = await db
    .select({ providerAccountId: accounts.providerAccountId })
    .from(accounts)
    .innerJoin(users, eq(users.id, accounts.userId))
    .where(and(sql`lower(${users.email}) = ${address}`, eq(accounts.provider, "google")))
    .limit(100);
  return linked.length > 0 && !linked.some((a) => a.providerAccountId === providerAccountId);
}
