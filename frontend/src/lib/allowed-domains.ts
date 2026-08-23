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

/**
 * Which email domains may sign in.
 *
 * Two sources, unioned:
 *
 *   - `allowed_email_domains`, managed by an administrator on the settings
 *     page. This is the one people use.
 *   - `AUTH_ALLOWED_EMAIL_DOMAINS`, from the environment. Not editable in the
 *     app, and always in force — the same bootstrap-from-outside role that
 *     `SITE_ADMIN_EMAILS` plays for roles.
 *
 * If both are empty there is no restriction, which is how the site behaves
 * before anybody configures it.
 */

/** The environment's contribution. Shown on the settings page, read-only. */
export function envAllowedDomains(): string[] {
  return parseDomainList(process.env.AUTH_ALLOWED_EMAIL_DOMAINS);
}

/** Every domain currently in force, from both sources, deduplicated. */
export async function effectiveAllowedDomains(): Promise<string[]> {
  const rows = await db
    .select({ domain: allowedEmailDomains.domain })
    .from(allowedEmailDomains);

  return [...new Set([...envAllowedDomains(), ...rows.map((r) => r.domain)])];
}

/**
 * Whether an address may sign in. One query, on sign-in only — the session
 * callback doesn't ask, so this costs nothing per page load.
 *
 * Bootstrap administrators are allowed whatever their domain: they are the way
 * back in, so a domain list that happens not to cover them must not be able to
 * lock the site out of its own administration.
 */
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
  /** Who added it, for the settings table. Null once that account is deleted. */
  addedBy: string | null;
};

/** The managed rows, for the settings page. */
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

/**
 * The body both write routes accept. Length caps only — what counts as a
 * domain is `normalizeDomain`'s business, and it rewrites as well as checks,
 * so it runs on the way to the database rather than here.
 */
export const domainInputSchema = z.object({
  domain: z.string().min(1).max(ALLOWED_DOMAIN_LIMITS.domain),
  note: z.string().max(ALLOWED_DOMAIN_LIMITS.note).optional(),
});

export const STATUS_FOR: Record<DomainError, number> = {
  invalid: 400,
  duplicate: 409,
  not_found: 404,
  // Understood, and refused on a rule about the requester rather than on
  // anything malformed in the request — which is what 409 says.
  self_lockout: 409,
};

/** Who is making the change — enough to check they aren't locking themselves out. */
export type Actor = { id: string; email: string | null | undefined };

/**
 * Refuse a change that would shut the person making it out of the site.
 *
 * Adding the first domain is the dangerous one: until then everyone is allowed,
 * and the moment a list exists everyone outside it is not — including,
 * potentially, the administrator who just created it. They would find out at
 * their next sign-in, with no way back except a redeploy. Editing and deleting
 * are checked by the same rule, since either can narrow the list the same way.
 *
 * A change that empties the list is fine: no list is no restriction.
 */
function wouldLockOut(actor: Actor, nextDomains: string[]): boolean {
  if (isBootstrapAdmin(actor.email)) return false;
  return !emailAllowedBy(actor.email, [
    ...new Set([...envAllowedDomains(), ...nextDomains]),
  ]);
}

/** Current managed domains as `id -> domain`, for computing what a change leaves. */
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
