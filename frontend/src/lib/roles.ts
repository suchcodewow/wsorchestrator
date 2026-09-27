/** The functional areas, the roles within each, and what each one may do. */

import {
  EVENT_ROLES,
  SCHEDULER_ROLES,
  type EventRole,
  type SchedulerRole,
} from "@/db/schema";

/**
 * Everything a signed-in user may do, one entry per functional area. A
 * platform administrator counts as an administrator in every area, whatever
 * their stored per-area roles say — so read roles through `eventRoleOf` and
 * `schedulerRoleOf`, never off this object directly.
 */
export type Access = {
  event: EventRole;
  scheduler: SchedulerRole | null;
  platform: boolean;
};

/** An area whose roles are granted by that area's own administrators. */
export type Area = "event" | "scheduler";

export const EVENT_ROLE_LABELS: Record<EventRole, string> = {
  none: "No event access",
  contributor: "Event Contributor",
  operator: "Event Operator",
  manager: "Event Manager",
  administrator: "Event Administrator",
};

export const EVENT_ROLE_DESCRIPTIONS: Record<EventRole, string> = {
  none: "Cannot see or run events.",
  contributor: "Writes Harness components but cannot run events.",
  operator: "Schedules and runs their own events.",
  manager:
    "Also sees every user's events, can delete any of them, and writes the lab guides.",
  administrator: "Also manages event settings and everyone's event role.",
};

export const SCHEDULER_ROLE_LABELS: Record<SchedulerRole, string> = {
  viewer: "Scheduler Viewer",
  administrator: "Scheduler Administrator",
};

export const SCHEDULER_ROLE_DESCRIPTIONS: Record<SchedulerRole, string> = {
  viewer: "Sees the scheduler.",
  administrator: "Also manages scheduler settings and everyone's scheduler role.",
};

export const NO_SCHEDULER_ACCESS_LABEL = "No scheduler access";

export const PLATFORM_ADMIN_LABEL = "Platform Administrator";

export const PLATFORM_ADMIN_DESCRIPTION =
  "An administrator in every area. Also runs backups, the database console and sign-in domains, and grants platform administration.";

export function eventRoleOf(access: Access): EventRole {
  return access.platform ? "administrator" : access.event;
}

export function schedulerRoleOf(access: Access): SchedulerRole | null {
  return access.platform ? "administrator" : access.scheduler;
}

function eventAtLeast(access: Access, minimum: EventRole): boolean {
  return EVENT_ROLES.indexOf(eventRoleOf(access)) >= EVENT_ROLES.indexOf(minimum);
}

function schedulerAtLeast(access: Access, minimum: SchedulerRole): boolean {
  const role = schedulerRoleOf(access);
  return role !== null && SCHEDULER_ROLES.indexOf(role) >= SCHEDULER_ROLES.indexOf(minimum);
}

// The event area.

export const canUseEvents = (access: Access) => eventAtLeast(access, "contributor");

export const canCreateEvents = (access: Access) => eventAtLeast(access, "operator");

export const canContributeComponents = (access: Access) =>
  eventAtLeast(access, "contributor");

export const canPublishComponents = (access: Access) =>
  eventAtLeast(access, "manager");

export const canSeeAllEvents = (access: Access) => eventAtLeast(access, "manager");

export const canManageAnyEvent = (access: Access) =>
  eventAtLeast(access, "manager");

export const canManageLabGuides = (access: Access) =>
  eventAtLeast(access, "manager");

export const canManageSettings = (access: Access) =>
  eventAtLeast(access, "administrator");

export const canAuditProjects = (access: Access) =>
  eventAtLeast(access, "administrator");

// The scheduler area.

export const canUseScheduler = (access: Access) => schedulerAtLeast(access, "viewer");

export const canManageSchedulerSettings = (access: Access) =>
  schedulerAtLeast(access, "administrator");

// The platform: whatever reaches past a single area.

export const canRunSql = (access: Access) => access.platform;

export const canManageBackups = (access: Access) => access.platform;

export const canManageSignInDomains = (access: Access) => access.platform;

/** Whether `access` may set other people's role in `area`, or the platform flag. */
export function canManageRoles(access: Access, area: Area | "platform"): boolean {
  switch (area) {
    case "event":
      return eventAtLeast(access, "administrator");
    case "scheduler":
      return schedulerAtLeast(access, "administrator");
    case "platform":
      return access.platform;
  }
}

export const canManageUsers = (access: Access) =>
  canManageRoles(access, "event") || canManageRoles(access, "scheduler");

/** The labels worth showing beside someone's name; an ordinary operator has none. */
export function accessBadges(access: Access): string[] {
  if (access.platform) return [PLATFORM_ADMIN_LABEL];

  const badges: string[] = [];
  if (access.event !== "none" && access.event !== "operator") {
    badges.push(EVENT_ROLE_LABELS[access.event]);
  }
  if (access.scheduler) badges.push(SCHEDULER_ROLE_LABELS[access.scheduler]);
  return badges;
}

/** Where a signed-in user lands: the first area they can use. */
export function homePath(access: Access): string {
  if (canUseEvents(access)) return "/events";
  if (canUseScheduler(access)) return "/scheduler";
  return "/welcome";
}

export function asEventRole(value: unknown): EventRole | null {
  return EVENT_ROLES.includes(value as EventRole) ? (value as EventRole) : null;
}

export function asSchedulerRole(value: unknown): SchedulerRole | null {
  return SCHEDULER_ROLES.includes(value as SchedulerRole)
    ? (value as SchedulerRole)
    : null;
}
