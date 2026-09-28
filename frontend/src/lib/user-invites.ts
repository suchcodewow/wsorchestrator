/**
 * Invite links: roles handed to whoever follows one and signs in.
 *
 * - A link works for anyone, any number of times, for INVITE_TTL_MINUTES.
 * - It only ever gives roles to someone with none. Anyone who already has
 *   access in any area is left exactly as they are, so a link can't demote a
 *   manager who clicks an operator invite.
 * - It grants only what its creator administers, checked when it is made and
 *   again when it is used: an administrator who loses the role takes their
 *   open links with them.
 * - It never grants platform administration.
 * - It does not get anyone past sign-in: the sign-in domain limit applies
 *   before the invite page is ever reached.
 */

import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  INVITE_TTL_MINUTES,
  userInvites,
  users,
  type EventRole,
  type SchedulerRole,
} from "@/db/schema";
import { canManageRoles, type Access } from "@/lib/roles";

/** What a link grants; null leaves that area without access. */
export type InviteGrant = {
  eventRole: Exclude<EventRole, "none"> | null;
  schedulerRole: SchedulerRole | null;
};

const TOKEN_BYTES = 24;
/** base64url of TOKEN_BYTES, so anything else is refused before a lookup. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{32}$/;

const sha256 = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex");

/** Whether `access` administers every area `grant` hands out. */
export function mayGrant(access: Access, grant: InviteGrant): boolean {
  return (
    (grant.eventRole === null || canManageRoles(access, "event")) &&
    (grant.schedulerRole === null || canManageRoles(access, "scheduler"))
  );
}

/**
 * - `empty`     — the link would grant nothing.
 * - `forbidden` — the actor does not administer an area it grants.
 */
export type CreateInviteError = "empty" | "forbidden";

export async function createInvite(
  actor: { id: string; access: Access },
  grant: InviteGrant,
): Promise<
  | { ok: true; token: string; expiresAt: Date }
  | { ok: false; error: CreateInviteError }
> {
  if (grant.eventRole === null && grant.schedulerRole === null) {
    return { ok: false, error: "empty" };
  }
  if (!mayGrant(actor.access, grant)) return { ok: false, error: "forbidden" };

  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  const expiresAt = new Date(Date.now() + INVITE_TTL_MINUTES * 60 * 1000);

  await db.insert(userInvites).values({
    tokenHash: sha256(token),
    eventRole: grant.eventRole,
    schedulerRole: grant.schedulerRole,
    createdBy: actor.id,
    expiresAt,
  });

  return { ok: true, token, expiresAt };
}

export type Invite = {
  id: string;
  grant: InviteGrant;
  invitedBy: string | null;
  expiresAt: Date;
};

/**
 * - `not_found` — no such link.
 * - `expired`   — past its INVITE_TTL_MINUTES.
 * - `revoked`   — its creator no longer administers an area it grants.
 */
export type InviteError = "not_found" | "expired" | "revoked";

export async function readInvite(
  token: string,
): Promise<{ ok: true; invite: Invite } | { ok: false; error: InviteError }> {
  if (!TOKEN_SHAPE.test(token)) return { ok: false, error: "not_found" };

  const [row] = await db
    .select({
      id: userInvites.id,
      eventRole: userInvites.eventRole,
      schedulerRole: userInvites.schedulerRole,
      expiresAt: userInvites.expiresAt,
      creatorName: users.name,
      creatorEmail: users.email,
      creatorEvent: users.eventRole,
      creatorScheduler: users.schedulerRole,
      creatorPlatform: users.isPlatformAdmin,
    })
    .from(userInvites)
    .innerJoin(users, eq(users.id, userInvites.createdBy))
    .where(eq(userInvites.tokenHash, sha256(token)));

  if (!row) return { ok: false, error: "not_found" };
  if (row.expiresAt.getTime() <= Date.now()) return { ok: false, error: "expired" };

  const grant: InviteGrant = {
    eventRole: row.eventRole === "none" ? null : row.eventRole,
    schedulerRole: row.schedulerRole,
  };
  const creator: Access = {
    event: row.creatorEvent,
    scheduler: row.creatorScheduler,
    platform: row.creatorPlatform,
  };
  if (!mayGrant(creator, grant)) return { ok: false, error: "revoked" };

  return {
    ok: true,
    invite: {
      id: row.id,
      grant,
      invitedBy: row.creatorName ?? row.creatorEmail,
      expiresAt: row.expiresAt,
    },
  };
}

/**
 * Gives `userId` the link's roles if they have none. `applied` is false for
 * anyone who already had access, who is left untouched.
 */
export async function acceptInvite(
  userId: string,
  token: string,
): Promise<
  | { ok: true; applied: boolean; grant: InviteGrant }
  | { ok: false; error: InviteError }
> {
  const read = await readInvite(token);
  if (!read.ok) return read;
  const { invite } = read;

  const applied = await db.transaction(async (tx) => {
    // The no-access check is in the WHERE, so a role granted between reading
    // the user and writing them is never overwritten.
    const updated = await tx
      .update(users)
      .set({
        eventRole: invite.grant.eventRole ?? "none",
        schedulerRole: invite.grant.schedulerRole,
      })
      .where(
        and(
          eq(users.id, userId),
          eq(users.eventRole, "none"),
          isNull(users.schedulerRole),
          eq(users.isPlatformAdmin, false),
        ),
      )
      .returning({ id: users.id });

    if (updated.length === 0) return false;
    await tx
      .update(userInvites)
      .set({ uses: sql`${userInvites.uses} + 1` })
      .where(eq(userInvites.id, invite.id));
    return true;
  });

  return { ok: true, applied, grant: invite.grant };
}
