/** The email domains allowed to sign in, from the environment and the database. */

import "server-only";

import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { ALLOWED_DOMAIN_LIMITS, allowedEmailDomains, users } from "@/db/schema";
import {
  emailAllowedBy,
  normalizeDomain,
  parseDomainList,
} from "@/lib/email-domains";
import { isBootstrapAdmin } from "@/lib/site-admins";

export function envAllowedDomains(): string[] {
  return parseDomainList(process.env.AUTH_ALLOWED_EMAIL_DOMAINS);
}

export async function effectiveAllowedDomains(): Promise<string[]> {
  const rows = await db
    .select({ domain: allowedEmailDomains.domain })
    .from(allowedEmailDomains);

  return [...new Set([...envAllowedDomains(), ...rows.map((r) => r.domain)])];
}

export async function isEmailAllowed(
  email: string | null | undefined,
): Promise<boolean> {
  if (isBootstrapAdmin(email)) return true;
  return emailAllowedBy(email, await effectiveAllowedDomains());
}

export type AllowedDomainRow = {
  id: string;
  domain: string;
  note: string;
  createdAt: Date;
  addedBy: string | null;
};

export async function listAllowedDomains(): Promise<AllowedDomainRow[]> {
  const rows = await db
    .select({
      id: allowedEmailDomains.id,
      domain: allowedEmailDomains.domain,
      note: allowedEmailDomains.note,
      createdAt: allowedEmailDomains.createdAt,
      addedByName: users.name,
      addedByEmail: users.email,
    })
    .from(allowedEmailDomains)
    .leftJoin(users, eq(users.id, allowedEmailDomains.createdBy))
    .orderBy(asc(allowedEmailDomains.domain));

  return rows.map(({ addedByName, addedByEmail, ...row }) => ({
    ...row,
    addedBy: addedByName ?? addedByEmail,
  }));
}

export type DomainError =
  | "invalid"
  | "duplicate"
  | "not_found"
  | "self_lockout";

type Result = { ok: true } | { ok: false; error: DomainError };

export const domainInputSchema = z.object({
  domain: z.string().min(1).max(ALLOWED_DOMAIN_LIMITS.domain),
  note: z.string().max(ALLOWED_DOMAIN_LIMITS.note).optional(),
});

export const STATUS_FOR: Record<DomainError, number> = {
  invalid: 400,
  duplicate: 409,
  not_found: 404,
  self_lockout: 409,
};

export type Actor = { id: string; email: string | null | undefined };

function wouldLockOut(actor: Actor, nextDomains: string[]): boolean {
  if (isBootstrapAdmin(actor.email)) return false;
  return !emailAllowedBy(actor.email, [
    ...new Set([...envAllowedDomains(), ...nextDomains]),
  ]);
}

async function currentDomains(): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: allowedEmailDomains.id, domain: allowedEmailDomains.domain })
    .from(allowedEmailDomains);
  return new Map(rows.map((r) => [r.id, r.domain]));
}

export async function addAllowedDomain(
  actor: Actor,
  input: { domain: string; note?: string },
): Promise<Result> {
  const domain = normalizeDomain(input.domain);
  if (!domain) return { ok: false, error: "invalid" };

  const current = await currentDomains();
  if ([...current.values()].includes(domain)) {
    return { ok: false, error: "duplicate" };
  }
  if (wouldLockOut(actor, [...current.values(), domain])) {
    return { ok: false, error: "self_lockout" };
  }

  await db.insert(allowedEmailDomains).values({
    domain,
    note: input.note?.trim() ?? "",
    createdBy: actor.id,
  });
  return { ok: true };
}

export async function updateAllowedDomain(
  actor: Actor,
  id: string,
  input: { domain: string; note?: string },
): Promise<Result> {
  const domain = normalizeDomain(input.domain);
  if (!domain) return { ok: false, error: "invalid" };

  const current = await currentDomains();
  if (!current.has(id)) return { ok: false, error: "not_found" };
  for (const [otherId, otherDomain] of current) {
    if (otherId !== id && otherDomain === domain) {
      return { ok: false, error: "duplicate" };
    }
  }

  const next = new Map(current).set(id, domain);
  if (wouldLockOut(actor, [...next.values()])) {
    return { ok: false, error: "self_lockout" };
  }

  await db
    .update(allowedEmailDomains)
    .set({ domain, note: input.note?.trim() ?? "" })
    .where(eq(allowedEmailDomains.id, id));
  return { ok: true };
}

export async function deleteAllowedDomain(
  actor: Actor,
  id: string,
): Promise<Result> {
  const current = await currentDomains();
  if (!current.has(id)) return { ok: false, error: "not_found" };

  const next = new Map(current);
  next.delete(id);
  if (wouldLockOut(actor, [...next.values()])) {
    return { ok: false, error: "self_lockout" };
  }

  await db.delete(allowedEmailDomains).where(eq(allowedEmailDomains.id, id));
  return { ok: true };
}
