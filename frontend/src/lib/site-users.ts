/** Reads everyone with an account, sets their roles, and deletes them. */

import "server-only";

import { asc, count, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  users,
  workshopRuns,
  type EvalsRole,
  type EventRole,
  type TrainingRole,
} from "@/db/schema";
import { canDeleteUsers, canManageRoles, type Access } from "@/lib/roles";
import { countRunsForUsers } from "@/lib/runs";
import { isBootstrapAdmin } from "@/lib/site-admins";

export type SiteUser = {
  id: string;
  name: string | null;
  email: string | null;
  eventRole: EventRole;
  trainingRole: TrainingRole | null;
  evalsRole: EvalsRole | null;
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
        trainingRole: users.trainingRole,
        evalsRole: users.evalsRole,
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
  | { area: "training"; role: TrainingRole | null }
  | { area: "evals"; role: EvalsRole | null }
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
      : change.area === "training"
        ? { trainingRole: change.role }
        : change.area === "evals"
          ? { evalsRole: change.role }
          : { isPlatformAdmin: change.value };

  const updated = await db
    .update(users)
    .set(set)
    .where(eq(users.id, targetUserId))
    .returning({ id: users.id });

  if (updated.length === 0) return { ok: false, error: "not_found" };
  return { ok: true };
}

/**
 * - `self`        — nobody deletes their own account, so the last platform
 *                   administrator can never remove themselves.
 * - `forbidden`   — only a platform administrator deletes accounts.
 * - `bootstrap`   — SITE_ADMIN_EMAILS would recreate it, as a platform
 *                   administrator, on their next sign-in.
 * - `owns_events` — events keep their owner, and carry cloud resources that
 *                   are torn down through the event, not by deleting a person.
 */
export type DeleteUserError =
  | "not_found"
  | "self"
  | "forbidden"
  | "bootstrap"
  | "owns_events";

/** Removes an account, its sessions and its own settings; what they authored stays, unattributed. */
export async function deleteUser(
  actor: { id: string; access: Access },
  targetUserId: string,
): Promise<{ ok: true } | { ok: false; error: DeleteUserError }> {
  if (actor.id === targetUserId) return { ok: false, error: "self" };
  if (!canDeleteUsers(actor.access)) return { ok: false, error: "forbidden" };

  const [target] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, targetUserId));

  if (!target) return { ok: false, error: "not_found" };
  if (isBootstrapAdmin(target.email)) return { ok: false, error: "bootstrap" };

  const [{ events }] = await db
    .select({ events: count() })
    .from(workshopRuns)
    .where(eq(workshopRuns.userId, targetUserId));
  if (events > 0) return { ok: false, error: "owns_events" };

  try {
    const deleted = await db
      .delete(users)
      .where(eq(users.id, targetUserId))
      .returning({ id: users.id });
    if (deleted.length === 0) return { ok: false, error: "not_found" };
  } catch (err) {
    // An event created since the count above still holds its owner.
    if (pgCode(err) === "23503") return { ok: false, error: "owns_events" };
    throw err;
  }
  return { ok: true };
}

function pgCode(err: unknown): string | undefined {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code ?? e?.cause?.code;
}
