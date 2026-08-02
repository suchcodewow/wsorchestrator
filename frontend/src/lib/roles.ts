import { SITE_ROLES, type SiteRole } from "@/db/schema";

/**
 * Site roles and what each one unlocks.
 *
 * Deliberately pure — no database, no session — so the menu, the pages, the
 * API routes, and the runner-facing helpers all decide from the same rules
 * rather than each re-stating them. The server is still the only enforcer:
 * everything a client hides here is checked again before it takes effect.
 */

/** Roles above an operator, for the "who can see this" copy in the UI. */
export const SITE_ROLE_LABELS: Record<SiteRole, string> = {
  operator: "Operator",
  manager: "Manager",
  administrator: "Administrator",
};

export const SITE_ROLE_DESCRIPTIONS: Record<SiteRole, string> = {
  operator: "Schedules and runs their own events.",
  manager:
    "Also sees every user's events, can delete any of them, and writes the lab guides.",
  administrator: "Also manages the site's users and their roles.",
};

/**
 * Whether `role` is at least as privileged as `minimum`. The comparison is by
 * position in `SITE_ROLES`, which is ordered least to most privileged.
 */
export function roleAtLeast(role: SiteRole, minimum: SiteRole): boolean {
  return SITE_ROLES.indexOf(role) >= SITE_ROLES.indexOf(minimum);
}

/** Flip the calendar to every user's events rather than only their own. */
export const canSeeAllEvents = (role: SiteRole) => roleAtLeast(role, "manager");

/** Open, reconfigure, and delete an event belonging to somebody else. */
export const canManageAnyEvent = (role: SiteRole) =>
  roleAtLeast(role, "manager");

/**
 * Write, edit, publish, and delete the lab guides.
 *
 * The guides themselves are world-readable, so this gates writing only — and
 * it is the one permission here whose effect is visible to people who have no
 * account at all, which is reason enough not to hand it to every operator.
 */
export const canManageLabGuides = (role: SiteRole) =>
  roleAtLeast(role, "manager");

/** List the site's users and set their roles. */
export const canManageUsers = (role: SiteRole) =>
  roleAtLeast(role, "administrator");

/**
 * Run read-only SQL against the database from the in-app console.
 *
 * Administrators only, and even for them the server runs every query inside a
 * READ ONLY transaction so it cannot write. It still reads whatever it is
 * pointed at — session tokens, OAuth tokens, attendee passwords — so it sits at
 * the top role, the same as users and backups.
 */
export const canRunSql = (role: SiteRole) =>
  roleAtLeast(role, "administrator");

/**
 * Review the database's backup history, take one, and restore from one.
 *
 * The most consequential thing anybody can do here — a restore rolls the whole
 * instance back, this account's own session included — so it sits at the top
 * role and nowhere lower.
 */
export const canManageBackups = (role: SiteRole) =>
  roleAtLeast(role, "administrator");

/** Narrow an untrusted string — a form value, a JSON body — to a role. */
export function asSiteRole(value: unknown): SiteRole | null {
  return SITE_ROLES.includes(value as SiteRole) ? (value as SiteRole) : null;
}
