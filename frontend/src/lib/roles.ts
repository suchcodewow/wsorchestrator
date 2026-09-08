/** The site roles, and what each one may do. */

import { SITE_ROLES, type SiteRole } from "@/db/schema";

export const SITE_ROLE_LABELS: Record<SiteRole, string> = {
  contributor: "Contributor",
  operator: "Operator",
  manager: "Manager",
  administrator: "Administrator",
};

export const SITE_ROLE_DESCRIPTIONS: Record<SiteRole, string> = {
  contributor: "Writes Harness components but cannot run events.",
  operator: "Schedules and runs their own events.",
  manager:
    "Also sees every user's events, can delete any of them, and writes the lab guides.",
  administrator: "Also manages the site's users and their roles.",
};

export function roleAtLeast(role: SiteRole, minimum: SiteRole): boolean {
  return SITE_ROLES.indexOf(role) >= SITE_ROLES.indexOf(minimum);
}

export const canCreateEvents = (role: SiteRole) => roleAtLeast(role, "operator");

export const canContributeComponents = (role: SiteRole) =>
  roleAtLeast(role, "contributor");

export const canPublishComponents = (role: SiteRole) =>
  roleAtLeast(role, "manager");

export const canSeeAllEvents = (role: SiteRole) => roleAtLeast(role, "manager");

export const canManageAnyEvent = (role: SiteRole) =>
  roleAtLeast(role, "manager");

export const canManageLabGuides = (role: SiteRole) =>
  roleAtLeast(role, "manager");

export const canManageUsers = (role: SiteRole) =>
  roleAtLeast(role, "administrator");

export const canManageSettings = (role: SiteRole) =>
  roleAtLeast(role, "administrator");

export const canRunSql = (role: SiteRole) =>
  roleAtLeast(role, "administrator");

export const canManageBackups = (role: SiteRole) =>
  roleAtLeast(role, "administrator");

export const canAuditProjects = (role: SiteRole) =>
  roleAtLeast(role, "administrator");

export function asSiteRole(value: unknown): SiteRole | null {
  return SITE_ROLES.includes(value as SiteRole) ? (value as SiteRole) : null;
}
