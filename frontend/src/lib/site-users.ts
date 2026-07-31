import "server-only";

import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { users, type SiteRole } from "@/db/schema";
import { countRunsForUsers } from "@/lib/runs";

export type SiteUser = {
  id: string;
  name: string | null;
  email: string | null;
  siteRole: SiteRole;
  /** How many events they have scheduled, ever. Context for a role change. */
  eventCount: number;
};

/** Everyone with an account, for the administrator's users page. */
export async function listSiteUsers(): Promise<SiteUser[]> {
  const [rows, counts] = await Promise.all([
    db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        siteRole: users.siteRole,
      })
      .from(users)
      .orderBy(asc(users.email)),
    countRunsForUsers(),
  ]);

  return rows.map((u) => ({ ...u, eventCount: counts.get(u.id) ?? 0 }));
}

export type SetSiteRoleError = "not_found" | "self";

/**
 * Set another user's role.
 *
 * An administrator cannot change their own — with one administrator on the
 * site, a mis-click would leave nobody able to hand the role back, and the
 * only way out would be `SITE_ADMIN_EMAILS` and a redeploy. Demoting an
 * administrator is therefore something a *second* administrator does.
 */
export async function setSiteRole(
  actorId: string,
  targetUserId: string,
  role: SiteRole,
): Promise<{ ok: true } | { ok: false; error: SetSiteRoleError }> {
  if (actorId === targetUserId) return { ok: false, error: "self" };

  const updated = await db
    .update(users)
    .set({ siteRole: role })
    .where(eq(users.id, targetUserId))
    .returning({ id: users.id });

  if (updated.length === 0) return { ok: false, error: "not_found" };
  return { ok: true };
}
