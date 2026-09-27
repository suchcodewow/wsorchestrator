/** Reads everyone with an account, and sets their roles. */

import "server-only";

import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { users, type EventRole, type SchedulerRole } from "@/db/schema";
import { canManageRoles, type Access } from "@/lib/roles";
import { countRunsForUsers } from "@/lib/runs";
import { isBootstrapAdmin } from "@/lib/site-admins";

export type SiteUser = {
  id: string;
  name: string | null;
  email: string | null;
  eventRole: EventRole;
  schedulerRole: SchedulerRole | null;
  isPlatformAdmin: boolean;
  /** Listed in SITE_ADMIN_EMAILS, so made a platform administrator on every sign-in. */
  isBootstrapAdmin: boolean;
  eventCount: number;
};

export async function listSiteUsers(): Promise<SiteUser[]> {
  const [rows, counts] = await Promise.all([
    db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        eventRole: users.eventRole,
        schedulerRole: users.schedulerRole,
        isPlatformAdmin: users.isPlatformAdmin,
      })
      .from(users)
      .orderBy(asc(users.email)),
    countRunsForUsers(),
  ]);

  return rows.map((u) => ({
    ...u,
    isBootstrapAdmin: isBootstrapAdmin(u.email),
    eventCount: counts.get(u.id) ?? 0,
  }));
}

export type RoleChange =
  | { area: "event"; role: EventRole }
  | { area: "scheduler"; role: SchedulerRole | null }
  | { area: "platform"; value: boolean };

/**
 * - `self`            — nobody changes their own roles; it takes a second
 *                       administrator, which also means the last platform
 *                       administrator can never remove themselves.
 * - `forbidden`       — the actor does not administer that area.
 * - `platform_target` — only a platform administrator may touch another one.
 * - `bootstrap`       — SITE_ADMIN_EMAILS would grant it straight back on their
 *                       next sign-in, so removing it would only look like it
 *                       worked.
 */
export type SetRoleError =
  | "not_found"
  | "self"
  | "forbidden"
  | "platform_target"
  | "bootstrap";

export async function setUserRole(
  actor: { id: string; access: Access },
  targetUserId: string,
  change: RoleChange,
): Promise<{ ok: true } | { ok: false; error: SetRoleError }> {
  if (actor.id === targetUserId) return { ok: false, error: "self" };
  if (!canManageRoles(actor.access, change.area)) {
    return { ok: false, error: "forbidden" };
  }

  const [target] = await db
    .select({ email: users.email, isPlatformAdmin: users.isPlatformAdmin })
    .from(users)
    .where(eq(users.id, targetUserId));

  if (!target) return { ok: false, error: "not_found" };
  if (target.isPlatformAdmin && !actor.access.platform) {
    return { ok: false, error: "platform_target" };
  }
  if (change.area === "platform" && !change.value && isBootstrapAdmin(target.email)) {
    return { ok: false, error: "bootstrap" };
  }

  const set =
    change.area === "event"
      ? { eventRole: change.role }
      : change.area === "scheduler"
        ? { schedulerRole: change.role }
        : { isPlatformAdmin: change.value };

  const updated = await db
    .update(users)
    .set(set)
    .where(eq(users.id, targetUserId))
    .returning({ id: users.id });

  if (updated.length === 0) return { ok: false, error: "not_found" };
  return { ok: true };
}
