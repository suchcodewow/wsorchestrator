/** Reads everyone with an account, sets their roles, and deletes them. */

import "server-only";

import { count, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  users,
  workshopRuns,
  type AssessmentsRole,
  type EventRole,
  type TrainingRole,
} from "@/db/schema";
import { noteAudit } from "@/lib/audit-context";
import { canDeleteUsers, canManageRoles, type Access } from "@/lib/roles";
import type { UserSort } from "@/lib/list-specs";
import { pageWindow, toPage, type ListQuery, type Page } from "@/lib/paging";
import { orderFor, searchAny } from "@/lib/paging-sql";
import { isBootstrapAdmin } from "@/lib/site-admins";

export type SiteUser = {
  id: string;
  name: string | null;
  email: string | null;
  eventRole: EventRole;
  trainingRole: TrainingRole | null;
  assessmentsRole: AssessmentsRole | null;
  isPlatformAdmin: boolean;
  /** Listed in SITE_ADMIN_EMAILS, so made a platform administrator on every sign-in. */
  isBootstrapAdmin: boolean;
  eventCount: number;
};

// Qualified by hand: in a single-table select Drizzle leaves column names bare,
// and a bare "id" inside this subquery would be workshop_runs.id.
const eventCount = sql<number>`(select count(*)::int from ${workshopRuns} where ${workshopRuns}."user_id" = ${users}."id")`;

const USER_SORT_COLUMNS = {
  user: sql`lower(coalesce(nullif(${users.name}, ''), ${users.email}))`,
  eventRole: users.eventRole,
  trainingRole: users.trainingRole,
  assessmentsRole: users.assessmentsRole,
  platform: users.isPlatformAdmin,
} as const;

/** One page of accounts, searched by name or email. */
export async function listSiteUsers(query: ListQuery<UserSort>): Promise<Page<SiteUser>> {
  const { limit, offset } = pageWindow(query.page);
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      eventRole: users.eventRole,
      trainingRole: users.trainingRole,
      assessmentsRole: users.assessmentsRole,
      isPlatformAdmin: users.isPlatformAdmin,
      eventCount,
    })
    .from(users)
    .where(searchAny(query.q, [users.name, users.email]))
    .orderBy(...orderFor(USER_SORT_COLUMNS[query.sort], query.dir, users.email, users.id))
    .limit(limit)
    .offset(offset);

  return toPage(
    rows.map((u) => ({ ...u, isBootstrapAdmin: isBootstrapAdmin(u.email) })),
    query.page,
  );
}

export type RoleChange =
  | { area: "event"; role: EventRole }
  | { area: "training"; role: TrainingRole | null }
  | { area: "assessments"; role: AssessmentsRole | null }
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
  noteAudit({ targetLabel: target.email ?? undefined });
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
        : change.area === "assessments"
          ? { assessmentsRole: change.role }
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
  noteAudit({ targetLabel: target.email ?? undefined });
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
