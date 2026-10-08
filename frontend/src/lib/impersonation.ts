/**
 * Viewing the app as someone else. A platform administrator picks anyone on
 * the employee list, and from then on their browser session is that person's:
 * `auth()` returns the employee, with the employee's roles, and keeps the
 * administrator in `session.impersonator`. It ends when they stop it, sign
 * out, or stop being a platform administrator.
 *
 * It is for seeing, not doing. Every non-GET route is refused with
 * `impersonating` while it lasts (`audited` checks), save the one that ends
 * it, so nothing is ever changed, and no token minted, in another person's
 * name. The theme stays the administrator's own.
 *
 * Someone who has never signed in has no account. They are shown as a new
 * account would be on its first visit, with a stand-in id no row has.
 */

import "server-only";

import { cookies } from "next/headers";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { employees, sessions, users } from "@/db/schema";
import { isBootstrapAdmin } from "@/lib/site-admins";

/** The route that starts and ends it, which stays open while it lasts. */
export const IMPERSONATION_PATH = "/api/me/impersonation";

/** The stand-in id of an employee with no account. */
export const NO_ACCOUNT_PREFIX = "employee:";

export type ImpersonationError = "not_found" | "self" | "platform_admin";

/** Who is being viewed as: their account, if they have one, and their name. */
export type ImpersonationTarget = {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  /** Their stored row, which the session callback builds their roles from; null with no account. */
  user: typeof users.$inferSelect | null;
};

/**
 * The employee with this email, and their account if they have one; null if
 * no employee has it.
 */
export async function impersonationTarget(email: string): Promise<ImpersonationTarget | null> {
  const lower = email.trim().toLowerCase();
  if (!lower) return null;

  const [employee] = await db
    .select({ id: employees.id, email: employees.email, fullName: employees.fullName })
    .from(employees)
    .where(eq(employees.email, lower))
    .limit(1);
  if (!employee) return null;

  const user = await db.query.users.findFirst({
    where: sql`lower(${users.email}) = ${lower}`,
  });

  return {
    id: user?.id ?? `${NO_ACCOUNT_PREFIX}${employee.id}`,
    email: lower,
    name: user?.name ?? employee.fullName,
    image: user?.image ?? null,
    user: user ?? null,
  };
}

/** Why `admin` may not view the app as `target`, or null if they may. */
export function impersonationRefusal(
  admin: { email?: string | null },
  target: ImpersonationTarget | null,
): ImpersonationError | null {
  if (!target) return "not_found";
  if (target.email === admin.email?.toLowerCase()) return "self";
  // They already see everything, so viewing as one shows nothing new.
  if (target.user?.isPlatformAdmin || isBootstrapAdmin(target.email)) return "platform_admin";
  return null;
}

/** Auth.js's cookie, under the name it uses over https and the one it uses over http. */
async function sessionToken(): Promise<string | null> {
  const jar = await cookies();
  return (
    jar.get("__Secure-authjs.session-token")?.value ??
    jar.get("authjs.session-token")?.value ??
    null
  );
}

/**
 * Starts or ends it on this browser's session, and only if that session
 * belongs to `userId`, the administrator. False if there is no such session.
 */
export async function setImpersonation(userId: string, email: string | null): Promise<boolean> {
  const token = await sessionToken();
  if (!token) return false;

  const updated = await db
    .update(sessions)
    .set({ impersonatingEmail: email?.toLowerCase() ?? null })
    .where(and(eq(sessions.sessionToken, token), eq(sessions.userId, userId)))
    .returning({ token: sessions.sessionToken });
  return updated.length > 0;
}
