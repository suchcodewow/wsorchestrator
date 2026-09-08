/** Reads everyone with an account, and sets their role. */

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
  eventCount: number;
};

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
